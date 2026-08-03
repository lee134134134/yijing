import fs from "node:fs";
import path from "node:path";
import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { config } from "../config.js";
import { ErrorCode, YijingError } from "../errors.js";
import type { KnowledgeDocument, KnowledgeMetadata } from "../types.js";

/**
 * 根据文件名推断知识域
 */
export function inferDomain(filename: string): string {
  const name = path.basename(filename, ".md").toLowerCase();

  const domainMap: Record<string, string> = {
    huangdi_neijing: "黄帝内经",
    shanghanlun: "伤寒论",
    jinguiyaolue: "金匮要略",
    shennongbencao: "神农本草经",
    zhenjiu: "针灸",
    tianjdao: "天纪",
    mingli_bazi: "命理八字",
    mianxiang: "面相学",
    zhongyi_xin: "中医临床",
    yangsheng: "养生功法",
    fangji: "方剂",
    yian: "医案",
    yinshi: "阴实理论",
    wenji: "文集",
    jiapu: "家谱",
  };

  return domainMap[name] || "综合";
}

/**
 * 读取单个 Markdown 文件，返回原始 Document
 */
function readMarkdownFile(filePath: string): KnowledgeDocument {
  const content = fs.readFileSync(filePath, "utf-8");
  const filename = path.basename(filePath);
  const domain = inferDomain(filename);

  return new Document<KnowledgeMetadata>({
    pageContent: content,
    metadata: {
      source: filename,
      domain,
    },
  });
}

/**
 * 递归读取 memory/ 目录下所有 Markdown 文件
 */
export function loadAllMarkdownFiles(): KnowledgeDocument[] {
  const knowledgeDir = config.knowledgeDir;

  if (!fs.existsSync(knowledgeDir)) {
    throw new YijingError(ErrorCode.CONFIG_ERROR, `知识库目录不存在: ${knowledgeDir}`);
  }

  const EXCLUDE = new Set(["README.md", "VERSION.md"]);

  const files = fs
    .readdirSync(knowledgeDir)
    .filter((f) => f.endsWith(".md") && !EXCLUDE.has(f))
    .map((f) => path.join(knowledgeDir, f));

  console.log(`找到 ${files.length} 个 Markdown 文件:`);
  for (const f of files) {
    const stats = fs.statSync(f);
    const sizeKB = (stats.size / 1024).toFixed(1);
    console.log(`  - ${path.basename(f)} (${sizeKB} KB)`);
  }

  return files.map(readMarkdownFile);
}

/**
 * 解析 Markdown 标题层级，生成更细粒度的文档块
 * 每个二级标题(##)下的内容作为一个独立块
 */
export function extractSections(doc: Document<{ source: string; domain: string }>): KnowledgeDocument[] {
  const content = doc.pageContent;
  const lines = content.split("\n");
  const sections: KnowledgeDocument[] = [];

  let currentH1 = "";
  let currentH2 = "";
  let currentH3 = "";
  let currentLines: string[] = [];
  let startLine = 1;

  // 提取文档标题（第一个 # 标题）
  const firstH1 = lines.find((l) => l.startsWith("# ") && !l.startsWith("##"));
  if (firstH1) {
    currentH1 = firstH1.replace(/^#\s+/, "").trim();
  }

  function flushSection(endLine: number) {
    const text = currentLines.join("\n").trim();
    if (text.length < 10) return; // 忽略过短的片段

    const metadata: KnowledgeMetadata = {
      ...doc.metadata,
      h1: currentH1,
      h2: currentH2 || undefined,
      h3: currentH3 || undefined,
      lineRange: `${startLine}-${endLine}`,
    };

    sections.push(
      new Document<KnowledgeMetadata>({
        pageContent: text,
        metadata,
      }),
    );
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h2Match = line.match(/^##\s+(.+)/);
    const h3Match = line.match(/^###\s+(.+)/);

    if (h2Match) {
      // 遇到新 H2，刷新上一个 section
      if (currentLines.length > 0) {
        flushSection(i);
      }
      currentH2 = h2Match[1].trim();
      currentH3 = "";
      currentLines = [line];
      startLine = i + 1;
    } else if (h3Match) {
      // 遇到新 H3：如果当前段落太短则合并（避免碎片化）
      const currentText = currentLines.join("\n").trim();
      if (currentLines.length > 0 && currentText.length >= 300) {
        flushSection(i);
      }
      currentH3 = h3Match[1].trim();
      currentLines = [line];
      startLine = i + 1;
    } else {
      currentLines.push(line);
    }
  }

  // 最后一个 section
  if (currentLines.length > 0) {
    flushSection(lines.length);
  }

  return sections;
}

/**
 * 对文档进行分块处理
 * 1. 先按 Markdown 标题结构拆分
 * 2. 对过长的块再做 RecursiveCharacterTextSplit
 */
export async function chunkDocuments(rawDocs: KnowledgeDocument[]): Promise<KnowledgeDocument[]> {
  console.log("\n正在按标题结构拆分文档...");

  // 第一步：按标题层级拆分为 sections
  const sections: KnowledgeDocument[] = [];
  for (const doc of rawDocs) {
    const docSections = extractSections(doc as Document<{ source: string; domain: string }>);
    sections.push(...docSections);
  }
  console.log(`  标题拆分后: ${sections.length} 个段落`);

  // 第二步：对过大的段落使用 RecursiveCharacterTextSplit
  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: config.chunkSize,
    chunkOverlap: config.chunkOverlap,
    separators: ["\n\n", "\n"],
  });

  const rawChunks = await textSplitter.splitDocuments(sections);
  const chunks = rawChunks.map((d: Document) => {
    return new Document<KnowledgeMetadata>({
      pageContent: d.pageContent,
      metadata: d.metadata as unknown as KnowledgeMetadata,
    });
  });
  console.log(`  最终分块: ${chunks.length} 个知识块`);

  return chunks;
}

/**
 * 统计知识库信息
 */
export function printKnowledgeStats(docs: KnowledgeDocument[]): void {
  const domains = new Map<string, number>();
  for (const doc of docs) {
    const domain = doc.metadata.domain;
    domains.set(domain, (domains.get(domain) || 0) + 1);
  }

  console.log("\n知识库统计:");
  console.log(`总知识块数: ${docs.length}`);
  console.log("\n按领域分布:");
  for (const [domain, count] of [...domains.entries()].sort((a, b) => b[1] - a[1])) {
    const pct = ((count / docs.length) * 100).toFixed(1);
    console.log(`  ${domain}: ${count} 块 (${pct}%)`);
  }

  const avgLen = docs.reduce((sum, d) => sum + d.pageContent.length, 0) / docs.length;
  console.log(`\n平均块长度: ${Math.round(avgLen)} 字符`);
  console.log(`总字符数: ${docs.reduce((sum, d) => sum + d.pageContent.length, 0).toLocaleString()}`);
}
