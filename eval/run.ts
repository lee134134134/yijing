/**
 * 检索质量评测(需要可用的 ChromaDB 与已构建索引)
 *
 * 用法:
 *   npm run eval
 *   npm run eval -- --fail-under 0.8
 *
 * 指标:
 * - recall@5:答案应出现的来源是否在 top5 中
 * - MRR:首个命中来源的排名倒数均值
 * - 无答案准确率:知识库无关问题是否返回空结果
 * - 平均检索延迟
 *
 * 说明:这里只评测"检索层",不调用 LLM,因此可离线重复、零 token 成本。
 * 回答质量/引用准确率应在接入真实模型后另行抽检。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../src/config.js";
import { assertStoreReady, searchKnowledge } from "../src/vectorstore/chroma.js";

interface GoldenItem {
  id: string;
  question: string;
  expected_sources: string[];
  should_answer: boolean;
}

interface Row {
  item: GoldenItem;
  ok: boolean;
  rank: number;
  top: Array<{ source: string; score?: number }>;
}

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const GOLDEN = path.join(ROOT, "eval", "golden.jsonl");
const REPORT = path.join(ROOT, "eval", "last-report.md");
const TOP_K = 5;

function loadGolden(): GoldenItem[] {
  const lines = fs
    .readFileSync(GOLDEN, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.map((line, i) => {
    const parsed = JSON.parse(line) as GoldenItem;
    if (!parsed.id || !parsed.question) throw new Error(`golden.jsonl 第 ${i + 1} 行缺少 id/question`);
    return { ...parsed, expected_sources: parsed.expected_sources ?? [] };
  });
}

function baseName(source: string): string {
  return source.split(/[\\/]/).pop() ?? source;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const items = loadGolden();
  await assertStoreReady();

  const rows: Row[] = [];
  let answerable = 0;
  let recallHits = 0;
  let mrrSum = 0;
  let noAnswerTotal = 0;
  let noAnswerCorrect = 0;
  let latencySum = 0;

  for (const item of items) {
    const started = Date.now();
    const docs = await searchKnowledge(item.question, TOP_K);
    latencySum += Date.now() - started;

    const top = docs.map((doc) => ({
      source: doc.metadata.source,
      ...(doc.score !== undefined ? { score: doc.score } : {}),
    }));

    if (!item.should_answer) {
      noAnswerTotal += 1;
      if (docs.length === 0) noAnswerCorrect += 1;
      rows.push({ item, ok: docs.length === 0, rank: 0, top });
      continue;
    }

    answerable += 1;
    const index = docs.findIndex((doc) => {
      const haystack = [
        doc.metadata.source,
        doc.metadata.book ?? "",
        doc.metadata.h1 ?? "",
        doc.metadata.h2 ?? "",
        doc.metadata.domain,
      ]
        .join(" ")
        .toLowerCase();
      return item.expected_sources.some(
        (source) => haystack.includes(source.toLowerCase()) || baseName(source) === baseName(doc.metadata.source),
      );
    });
    const rank = index >= 0 ? index + 1 : 0;
    if (rank > 0) {
      recallHits += 1;
      mrrSum += 1 / rank;
    }
    rows.push({ item, ok: rank > 0, rank, top });
  }

  const recall = answerable > 0 ? recallHits / answerable : 0;
  const mrr = answerable > 0 ? mrrSum / answerable : 0;
  const noAnswerAccuracy = noAnswerTotal > 0 ? noAnswerCorrect / noAnswerTotal : 1;
  const avgLatency = rows.length > 0 ? latencySum / rows.length : 0;

  const failures = rows.filter((row) => !row.ok);
  const lines = [
    "# RAG Eval Report",
    "",
    `- 生成时间: ${new Date().toISOString()}`,
    `- 索引: ${config.chromaCollectionName} | embedding: ${config.embeddingModel} | hybrid: ${config.enableHybrid} | minScore: ${config.minScore}`,
    `- 样本: ${items.length}（可回答 ${answerable} / 无答案 ${noAnswerTotal}）`,
    "",
    "| 指标 | 值 |",
    "|---|---|",
    `| recall@${TOP_K} | ${pct(recall)} (${recallHits}/${answerable}) |`,
    `| MRR | ${mrr.toFixed(3)} |`,
    `| 无答案准确率 | ${pct(noAnswerAccuracy)} (${noAnswerCorrect}/${noAnswerTotal}) |`,
    `| 平均检索延迟 | ${avgLatency.toFixed(0)} ms |`,
    "",
    "## 未命中 / 假阳性",
    "",
    failures.length === 0
      ? "无。"
      : [
          "| id | question | 期望来源 | top 结果 |",
          "|---|---|---|---|",
          ...failures.map((row) => {
            const top = row.top
              .slice(0, 3)
              .map((entry) => `${baseName(entry.source)}${entry.score !== undefined ? `(${entry.score.toFixed(2)})` : ""}`)
              .join(", ");
            return `| ${row.item.id} | ${row.item.question} | ${row.item.expected_sources.join(", ") || "-"} | ${top || "空"} |`;
          }),
        ].join("\n"),
    "",
  ];

  fs.writeFileSync(REPORT, lines.join("\n"), "utf-8");
  console.log(lines.join("\n"));

  const failUnderIndex = process.argv.indexOf("--fail-under");
  if (failUnderIndex >= 0) {
    const threshold = Number.parseFloat(process.argv[failUnderIndex + 1] ?? "");
    if (!Number.isFinite(threshold)) throw new Error("--fail-under 需要一个 0–1 的数值");
    if (recall < threshold) {
      console.error(`recall@${TOP_K} ${pct(recall)} < 阈值 ${pct(threshold)}`);
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error("评测失败:", err instanceof Error ? err.message : err);
  console.error("请先启动 ChromaDB 并运行 npm run ingest 构建索引。");
  process.exit(1);
});
