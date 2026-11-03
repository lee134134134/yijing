/**
 * FTS5 全文索引(中文 bigram)
 *
 * 为什么需要:
 * - 纯 dense 检索对中医专名(方剂、穴位、药材)召回不稳定
 * - SQLite FTS5 自带 BM25,而项目已经依赖 better-sqlite3,无需新增服务
 *
 * 中文处理:
 * - FTS5 的 unicode61 会把整段中文当成一个大 token,必须预分词
 * - 采用 bigram(桂枝汤 → "桂枝 枝汤"),查询同样处理
 * - 拉丁/数字按单词小写
 *
 * 表名带 _v2:元数据新增 book/chapter/page 等字段;旧表保留,避免 ALTER 限制。
 * 该索引是 dense 的补充:失败只降级,不影响主检索链路。
 */

import fs from "node:fs";
import path from "node:path";
import { Document } from "@langchain/core/documents";
import Database from "better-sqlite3";
import { config } from "../config.js";
import { createLogger } from "../logger.js";
import { buildCitation } from "../rag/citation.js";
import type { KnowledgeDocument, KnowledgeMetadata, RetrievedDocument } from "../types.js";

const log = createLogger("vectorstore:fts");
const TABLE = "chunks_fts_v2";

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;

  fs.mkdirSync(path.dirname(config.ftsDbPath), { recursive: true });
  const db = new Database(config.ftsDbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS ${TABLE} USING fts5(
      search_text,
      ref_id UNINDEXED,
      source UNINDEXED,
      h1 UNINDEXED,
      h2 UNINDEXED,
      h3 UNINDEXED,
      domain UNINDEXED,
      line_range UNINDEXED,
      book UNINDEXED,
      chapter UNINDEXED,
      section_path UNINDEXED,
      page_start UNINDEXED,
      page_end UNINDEXED,
      layer UNINDEXED,
      content UNINDEXED,
      tokenize = 'unicode61'
    );
  `);
  _db = db;
  return db;
}

/**
 * 中文 bigram + 拉丁单词分词
 *
 * 例:"桂枝汤的组成" → "桂枝 枝汤 汤的 的组 组成"
 */
export function tokenizeForFts(text: string): string {
  const tokens: string[] = [];
  const normalized = text.replace(/\s+/g, " ").trim();
  const re = /[\u3400-\u4dbf\u4e00-\u9fff]+|[A-Za-z0-9]+/g;

  for (const match of normalized.matchAll(re)) {
    const chunk = match[0]!;
    if (/^[A-Za-z0-9]+$/.test(chunk)) {
      tokens.push(chunk.toLowerCase());
      continue;
    }
    const chars = [...chunk];
    if (chars.length === 1) {
      tokens.push(chars[0]!);
      continue;
    }
    for (let i = 0; i < chars.length - 1; i++) {
      tokens.push(`${chars[i]}${chars[i + 1]}`);
    }
  }

  return tokens.join(" ");
}

/** 构造 FTS5 MATCH 表达式(OR 提升召回,BM25 负责排序) */
function buildMatchQuery(query: string): string {
  const unique = [...new Set(tokenizeForFts(query).split(" ").filter(Boolean))];
  return unique
    .map((token) => {
      const escaped = token.replace(/"/g, '""');
      // 单字查询用前缀匹配,避免 bigram 索引里没有单个 token
      return token.length === 1 ? `"${escaped}"*` : `"${escaped}"`;
    })
    .join(" OR ");
}

interface FtsInsertRow {
  search_text: string;
  ref_id: string;
  source: string;
  h1: string | null;
  h2: string | null;
  h3: string | null;
  domain: string;
  line_range: string | null;
  book: string | null;
  chapter: string | null;
  section_path: string | null;
  page_start: number | null;
  page_end: number | null;
  layer: string | null;
  content: string;
}

interface FtsRow {
  ref_id: string;
  source: string;
  h1: string | null;
  h2: string | null;
  h3: string | null;
  domain: string;
  line_range: string | null;
  book: string | null;
  chapter: string | null;
  section_path: string | null;
  page_start: number | null;
  page_end: number | null;
  layer: string | null;
  content: string;
}

/** 重建全文索引(ingest 时调用,整表替换) */
export async function rebuildFts(docs: KnowledgeDocument[]): Promise<number> {
  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO ${TABLE}
      (search_text, ref_id, source, h1, h2, h3, domain, line_range,
       book, chapter, section_path, page_start, page_end, layer, content)
    VALUES
      (@search_text, @ref_id, @source, @h1, @h2, @h3, @domain, @line_range,
       @book, @chapter, @section_path, @page_start, @page_end, @layer, @content)
  `);

  const rows: FtsInsertRow[] = docs.map((doc) => {
    const citation = buildCitation(doc);
    return {
      search_text: tokenizeForFts(
        [
          doc.pageContent,
          citation.h1 ?? "",
          citation.h2 ?? "",
          citation.h3 ?? "",
          citation.domain,
          citation.book ?? "",
          citation.chapter ?? "",
          citation.sectionPath ?? "",
        ].join("\n"),
      ),
      ref_id: citation.refId,
      source: citation.source,
      h1: citation.h1 ?? null,
      h2: citation.h2 ?? null,
      h3: citation.h3 ?? null,
      domain: citation.domain,
      line_range: citation.lineRange ?? null,
      book: citation.book ?? null,
      chapter: citation.chapter ?? null,
      section_path: citation.sectionPath ?? null,
      page_start: citation.pageStart ?? null,
      page_end: citation.pageEnd ?? null,
      layer: citation.layer ?? null,
      content: doc.pageContent,
    };
  });

  const tx = db.transaction((entries: FtsInsertRow[]) => {
    db.exec(`DELETE FROM ${TABLE}`);
    for (const entry of entries) insert.run(entry);
  });
  tx(rows);

  log.info({ count: rows.length }, "FTS index rebuilt");
  return rows.length;
}

/** BM25 检索(按相关度升序返回,不含相似度分数) */
export async function searchFts(query: string, topK: number): Promise<RetrievedDocument[]> {
  const match = buildMatchQuery(query);
  if (!match) return [];

  const rows = getDb()
    .prepare(
      `SELECT ref_id, source, h1, h2, h3, domain, line_range,
              book, chapter, section_path, page_start, page_end, layer, content
       FROM ${TABLE}
       WHERE ${TABLE} MATCH ?
       ORDER BY bm25(${TABLE})
       LIMIT ?`,
    )
    .all(match, topK) as FtsRow[];

  return rows.map(
    (row) =>
      new Document<KnowledgeMetadata>({
        pageContent: row.content,
        metadata: {
          source: row.source,
          domain: row.domain,
          h1: row.h1 ?? undefined,
          h2: row.h2 ?? undefined,
          h3: row.h3 ?? undefined,
          lineRange: row.line_range ?? undefined,
          book: row.book ?? undefined,
          chapter: row.chapter ?? undefined,
          sectionPath: row.section_path ?? undefined,
          pageStart: row.page_start ?? undefined,
          pageEnd: row.page_end ?? undefined,
          layer: row.layer === "curated" || row.layer === "fulltext" ? row.layer : undefined,
        },
      }) as RetrievedDocument,
  );
}

/** 清空全文索引(clearAll / ingest 前) */
export async function clearFts(): Promise<void> {
  getDb().exec(`DELETE FROM ${TABLE}`);
}

/** 当前 FTS 文档数 */
export async function countFts(): Promise<number> {
  const row = getDb().prepare(`SELECT COUNT(*) AS count FROM ${TABLE}`).get() as { count: number };
  return row.count;
}

/** 关闭连接(测试 / 进程退出) */
export function closeFts(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
