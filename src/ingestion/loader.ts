import fs from "node:fs";
import path from "node:path";
import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { config } from "../config.js";
import { ErrorCode, YijingError } from "../errors.js";
import { createLogger } from "../logger.js";
import type { KnowledgeDocument, KnowledgeMetadata } from "../types.js";

const log = createLogger("ingestion:loader");

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
    renjiand: "天纪",
    dimaid: "天纪",
    ziwei: "紫微斗数",
    mingli_bazi: "命理八字",
    mianxiang: "面相学",
    zhongyi_xin: "中医临床",
    tiwu_xie: "中医临床",
    yanzhen: "中医临床",
    yangsheng: "养生功法",
    fangji: "方剂",
    yian: "医案",
    yinshi: "阴实理论",
    wenji: "文集",
    yaoxing: "神农本草经",
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
  const PRIVATE = new Set(["jiapu.md"]);

  const files = fs
    .readdirSync(knowledgeDir)
    .filter((f) => f.endsWith(".md") && !EXCLUDE.has(f))
    .filter((f) => {
      if (!PRIVATE.has(f)) return true;
      if (config.includePrivate) return true;
      log.warn({ file: f }, "Skipping private knowledge file (set INCLUDE_PRIVATE=true to index)");
      return false;
    })
    .map((f) => path.join(knowledgeDir, f));

  log.info(`找到 ${files.length} 个 Markdown 文件:`);
  for (const f of files) {
    const stats = fs.statSync(f);
    const sizeKB = (stats.size / 1024).toFixed(1);
    log.debug(`  - ${path.basename(f)} (${sizeKB} KB)`);
  }

  return files.map(readMarkdownFile);
}

/** 按 H3 再拆分 H2 的最小正文长度:短于此保持整块,避免碎片化与正文丢失 */
const MIN_H3_SPLIT_BODY = 300;
/** 低于此长度的块视为空块(通常只有短标题) */
const MIN_SECTION_CHARS = 10;

interface SectionDraft {
  h2?: string;
  h3?: string;
  /** 1-based,含 */
  startLine: number;
  /** 1-based,含 */
  endLine: number;
  lines: string[];
}

function headingTitle(line: string | undefined, level: 2 | 3): string {
  if (!line) return "";
  const match = line.match(level === 2 ? /^##\s+(.+)/ : /^###\s+(.+)/);
  return match?.[1]?.trim() ?? "";
}

/**
 * 解析 Markdown 标题层级,生成更细粒度的文档块
 *
 * 不变式:原文中所有非空行必须至少落在一个 section 里。
 * 旧实现遇到"短正文 + H3"时会直接重置 currentLines,导致 H2 正文被丢弃;
 * 这里改为两遍扫描(先定位标题边界,再按边界切片),不再有覆盖写入。
 *
 * 拆分规则:
 * - 每个 H2 默认一个块(含其下 H3 内容)
 * - 若 H2 在第一个 H3 之前已有 >= MIN_H3_SPLIT_BODY 的正文,则拆为
 *   "H2 引言 + 每个 H3 独立块"
 * - 首个 H2 之前的前言(H1 等)单独成块
 */
export function extractSections(doc: Document<{ source: string; domain: string }>): KnowledgeDocument[] {
  const lines = doc.pageContent.split("\n");
  const firstH1 = lines.find((l) => /^#\s+/.test(l) && !/^##/.test(l));
  const h1 = firstH1 ? firstH1.replace(/^#\s+/, "").trim() : "";

  // 第一遍:定位所有 H2 边界
  const h2Indices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i] ?? "")) h2Indices.push(i);
  }

  const drafts: SectionDraft[] = [];
  const pushDraft = (start: number, end: number, h2?: string, h3?: string): void => {
    if (end < start) return;
    drafts.push({
      h2,
      h3,
      startLine: start + 1,
      endLine: end + 1,
      lines: lines.slice(start, end + 1),
    });
  };

  // 首个 H2 之前的前言(H1、导语)
  const preambleEnd = h2Indices.length > 0 ? (h2Indices[0] ?? 0) - 1 : lines.length - 1;
  pushDraft(0, preambleEnd);

  // 第二遍:按 H2 边界切片,长正文再按 H3 切
  for (let k = 0; k < h2Indices.length; k++) {
    const start = h2Indices[k] ?? 0;
    const end = (h2Indices[k + 1] ?? lines.length) - 1;
    const h2 = headingTitle(lines[start], 2);

    const h3Indices: number[] = [];
    for (let i = start + 1; i <= end; i++) {
      if (/^###\s+/.test(lines[i] ?? "")) h3Indices.push(i);
    }

    if (h3Indices.length === 0) {
      pushDraft(start, end, h2);
      continue;
    }

    const firstH3 = h3Indices[0] ?? end + 1;
    const bodyBeforeFirstH3 = lines
      .slice(start + 1, firstH3)
      .join("\n")
      .trim();

    // 正文太短:整块保留(含所有 H3),不拆、不丢
    if (bodyBeforeFirstH3.length < MIN_H3_SPLIT_BODY) {
      pushDraft(start, end, h2);
      continue;
    }

    // 正文足够长:H2 引言 + 每个 H3 独立成块
    pushDraft(start, firstH3 - 1, h2);
    for (let j = 0; j < h3Indices.length; j++) {
      const h3Start = h3Indices[j] ?? end + 1;
      const h3End = (h3Indices[j + 1] ?? end + 1) - 1;
      pushDraft(h3Start, h3End, h2, headingTitle(lines[h3Start], 3));
    }
  }

  const sections: KnowledgeDocument[] = [];
  for (const draft of drafts) {
    const text = draft.lines.join("\n").trim();
    if (text.length < MIN_SECTION_CHARS) continue; // 只有空白/短标题

    const metadata: KnowledgeMetadata = {
      ...doc.metadata,
      h1: h1 || undefined,
      h2: draft.h2 || undefined,
      h3: draft.h3 || undefined,
      lineRange: `${draft.startLine}-${draft.endLine}`,
    };

    sections.push(
      new Document<KnowledgeMetadata>({
        pageContent: text,
        metadata,
      }),
    );
  }

  return sections;
}

/**
 * 对文档进行分块处理
 * 1. 先按 Markdown 标题结构拆分
 * 2. 对过长的块再做 RecursiveCharacterTextSplit
 */
export async function chunkDocuments(rawDocs: KnowledgeDocument[]): Promise<KnowledgeDocument[]> {
  log.info("\n正在按标题结构拆分文档...");

  // 第一步：按标题层级拆分为 sections
  const sections: KnowledgeDocument[] = [];
  for (const doc of rawDocs) {
    const docSections = extractSections(doc as Document<{ source: string; domain: string }>);
    sections.push(...docSections);
  }
  log.info(`  标题拆分后: ${sections.length} 个段落`);

  // 第二步：对过大的段落使用 RecursiveCharacterTextSplit
  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: config.chunkSize,
    chunkOverlap: config.chunkOverlap,
    separators: ["\n\n", "\n"],
  });

  const rawChunks = await textSplitter.splitDocuments(sections);
  // splitDocuments 会向 metadata 注入内部字段 loc(对象),ChromaDB 仅接受标量值,
  // 因此显式挑选业务字段重建 metadata
  const chunks = rawChunks.map((d: Document) => {
    const meta = d.metadata as Record<string, unknown>;
    const metadata: KnowledgeMetadata = {
      source: meta.source as string,
      domain: meta.domain as string,
      h1: meta.h1 as string | undefined,
      h2: meta.h2 as string | undefined,
      h3: meta.h3 as string | undefined,
      lineRange: meta.lineRange as string | undefined,
      book: meta.book as string | undefined,
      chapter: meta.chapter as string | undefined,
      sectionPath: meta.sectionPath as string | undefined,
      pageStart: typeof meta.pageStart === "number" ? meta.pageStart : undefined,
      pageEnd: typeof meta.pageEnd === "number" ? meta.pageEnd : undefined,
      layer: meta.layer === "curated" || meta.layer === "fulltext" ? meta.layer : undefined,
    };
    return new Document<KnowledgeMetadata>({
      pageContent: d.pageContent,
      metadata,
    });
  });
  log.info(`  最终分块: ${chunks.length} 个知识块`);

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

  log.info("\n知识库统计:");
  log.info(`总知识块数: ${docs.length}`);
  log.info("\n按领域分布:");
  for (const [domain, count] of [...domains.entries()].sort((a, b) => b[1] - a[1])) {
    const pct = ((count / docs.length) * 100).toFixed(1);
    log.info(`  ${domain}: ${count} 块 (${pct}%)`);
  }

  const avgLen = docs.reduce((sum, d) => sum + d.pageContent.length, 0) / docs.length;
  log.info(`\n平均块长度: ${Math.round(avgLen)} 字符`);
  log.info(`总字符数: ${docs.reduce((sum, d) => sum + d.pageContent.length, 0).toLocaleString()}`);
}
