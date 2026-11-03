/**
 * 全文语料加载器
 *
 * 读取 `corpus/<book>/<chapter>.md`(由 tools/pdf2md 产出):
 * - 解析 YAML front-matter:book / chapter / section / pageStart / pageEnd
 * - 正文保留 Markdown 结构,供 extractSections 按标题切块
 * - layer=fulltext,便于与 memory/ 的 curated 摘要区分
 */

import fs from "node:fs";
import path from "node:path";
import { Document } from "@langchain/core/documents";
import YAML from "yaml";
import { createLogger } from "../logger.js";
import type { KnowledgeDocument, KnowledgeMetadata } from "../types.js";
import { inferDomain } from "./loader.js";

const log = createLogger("ingestion:corpus");

interface CorpusFrontMatter {
  book?: string;
  bookId?: string;
  chapter?: string;
  section?: string;
  pageStart?: number;
  pageEnd?: number;
  sourcePdf?: string;
  layer?: string;
}

/** 解析 `--- ... ---` front-matter;无 front-matter 时返回空对象 */
export function parseFrontMatter(raw: string): { data: CorpusFrontMatter; body: string } {
  const normalized = raw.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return { data: {}, body: normalized };

  const end = normalized.indexOf("\n---", 4);
  if (end < 0) return { data: {}, body: normalized };

  const yamlText = normalized.slice(4, end);
  let data: CorpusFrontMatter = {};
  try {
    const parsed = YAML.parse(yamlText) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      data = parsed as CorpusFrontMatter;
    }
  } catch (err) {
    log.warn({ err }, "Invalid corpus front-matter, treating as plain markdown");
  }

  const body = normalized.slice(end + 4).replace(/^\n/, "");
  return { data, body };
}

function walkMarkdown(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "qa" || entry.name === "node_modules") continue;
      files.push(...walkMarkdown(full));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md") {
      files.push(full);
    }
  }
  return files;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number.parseInt(value, 10);
  return undefined;
}

/**
 * 加载全文语料
 *
 * 目录不存在时返回空数组(允许只有 memory/ 摘要的部署)。
 */
export function loadCorpusFiles(corpusDir: string): KnowledgeDocument[] {
  if (!fs.existsSync(corpusDir)) {
    log.info({ corpusDir }, "Corpus directory not found, skipping fulltext layer");
    return [];
  }

  const files = walkMarkdown(corpusDir);
  const docs: KnowledgeDocument[] = [];

  for (const file of files) {
    const raw = fs.readFileSync(file, "utf-8");
    const { data, body } = parseFrontMatter(raw);
    if (body.trim().length < 10) continue;

    const relative = path.relative(corpusDir, file).split(path.sep).join("/");
    const book = data.book?.trim() || path.basename(path.dirname(file));
    const chapter = data.chapter?.trim() || data.section?.trim() || undefined;
    const metadata: KnowledgeMetadata = {
      source: relative,
      domain: book || inferDomain(file),
      h1: book,
      h2: chapter,
      book,
      ...(chapter ? { chapter } : {}),
      ...(data.section ? { sectionPath: data.section } : {}),
      ...(toNumber(data.pageStart) !== undefined ? { pageStart: toNumber(data.pageStart) } : {}),
      ...(toNumber(data.pageEnd) !== undefined ? { pageEnd: toNumber(data.pageEnd) } : {}),
      layer: "fulltext",
    };

    docs.push(new Document<KnowledgeMetadata>({ pageContent: body, metadata }));
  }

  log.info({ corpusDir, files: files.length, docs: docs.length }, "Corpus loaded");
  return docs;
}
