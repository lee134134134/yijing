/**
 * 本地向量存储 — 基于字符 n-gram 的中文语义检索 + BM25 混合搜索
 *
 * 原理：结合 n-gram Jaccard 相似度与 BM25 关键词匹配，
 *       通过 Reciprocal Rank Fusion (RRF) 融合排序结果。
 *
 * 存储结构:
 *   data/
 *     documents.json  - 文档内容 + 元数据
 */

import fs from "node:fs";
import path from "node:path";
import { Document } from "@langchain/core/documents";
import MiniSearch from "minisearch";
import { config } from "../config.js";
import type { KnowledgeDocument, KnowledgeMetadata } from "../types.js";

const DATA_DIR = path.resolve(process.cwd(), "data");
const DOCUMENTS_FILE = path.join(DATA_DIR, "documents.json");

// ========================================
// n-gram 中文语义检索
// ========================================

function getChars(text: string): string[] {
  return [...text];
}

function charNgrams(text: string, n: number): Set<string> {
  const chars = getChars(text);
  const ngrams = new Set<string>();
  for (let i = 0; i <= chars.length - n; i++) {
    ngrams.add(chars.slice(i, i + n).join(""));
  }
  return ngrams;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function computeQuerySignature(query: string) {
  return {
    bigrams: charNgrams(query, 2),
    trigrams: charNgrams(query, 3),
    chars: new Set(getChars(query)),
  };
}

function computeDocSignature(content: string) {
  const chars = getChars(content);
  const terms = new Set<string>();
  for (let i = 0; i < chars.length; i++) {
    for (let len = 2; len <= 4 && i + len <= chars.length; len++) {
      terms.add(chars.slice(i, i + len).join(""));
    }
  }
  return {
    bigrams: charNgrams(content, 2),
    trigrams: charNgrams(content, 3),
    chars: new Set(getChars(content)),
    keyTerms: terms,
  };
}

// ========================================
// 持久化
// ========================================

interface StoredDocument {
  id: string;
  content: string;
  metadata: KnowledgeMetadata;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadDocuments(): StoredDocument[] {
  ensureDataDir();
  if (!fs.existsSync(DOCUMENTS_FILE)) return [];
  return JSON.parse(fs.readFileSync(DOCUMENTS_FILE, "utf-8"));
}

function saveDocuments(docs: StoredDocument[]) {
  ensureDataDir();
  fs.writeFileSync(DOCUMENTS_FILE, JSON.stringify(docs, null, 2), "utf-8");
}

// ========================================
// BM25 全文索引（lazy init）
// ========================================

let _miniSearch: MiniSearch | null = null;

function buildMiniSearchIndex(docs: StoredDocument[]): MiniSearch {
  const ms = new MiniSearch({
    fields: ["content"],
    storeFields: ["source", "domain", "h1", "h2", "h3"],
    tokenize: (text) => {
      // 中文：按字符切分；英文/数字：按空格
      const tokens: string[] = [];
      for (const ch of text) {
        if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(ch)) {
          tokens.push(ch);
        }
      }
      // 同时保留英文单词
      const engWords = text.split(/[^a-zA-Z0-9]+/).filter(Boolean);
      return [...tokens, ...engWords.map((w) => w.toLowerCase())];
    },
    processTerm: (term) => term.toLowerCase(),
    searchOptions: {
      prefix: true,
      fuzzy: 0.2,
      boost: { content: 2 },
    },
  });
  for (const doc of docs) {
    ms.add({
      id: doc.id,
      content: doc.content.slice(0, 2000),
      source: doc.metadata.source || "",
      domain: doc.metadata.domain || "",
      h1: doc.metadata.h1 || "",
      h2: doc.metadata.h2 || "",
      h3: doc.metadata.h3 || "",
    });
  }
  return ms;
}

function getMiniSearch(docs: StoredDocument[]): MiniSearch {
  if (!_miniSearch) {
    _miniSearch = buildMiniSearchIndex(docs);
  }
  return _miniSearch;
}

function keywordSearch(
  query: string,
  docs: StoredDocument[],
  topK: number,
): Array<{ doc: StoredDocument; score: number }> {
  const ms = getMiniSearch(docs);
  const results = ms.search(query, { prefix: true, fuzzy: 0.2, boost: { content: 2 } });
  const docMap = new Map(docs.map((d) => [d.id, d]));
  return results
    .filter((r) => docMap.has(r.id))
    .slice(0, topK)
    .map((r) => ({ doc: docMap.get(r.id)!, score: r.score }));
}

function rrfFuse(
  vectorResults: Array<{ doc: StoredDocument; score: number }>,
  keywordResults: Array<{ doc: StoredDocument; score: number }>,
  topK: number,
  k: number = 60,
): Array<{ doc: StoredDocument; score: number }> {
  const combined = new Map<string, { doc: StoredDocument; score: number }>();

  vectorResults.forEach((entry, i) => {
    combined.set(entry.doc.id, { doc: entry.doc, score: 1 / (k + i) });
  });

  keywordResults.forEach((entry, i) => {
    const existing = combined.get(entry.doc.id);
    if (existing) {
      existing.score += 1 / (k + i);
    } else {
      combined.set(entry.doc.id, { doc: entry.doc, score: 1 / (k + i) });
    }
  });

  return Array.from(combined.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// ========================================
// 相似度评分
// ========================================

function scoreRelevance(query: string, doc: StoredDocument): number {
  const qSig = computeQuerySignature(query);
  const dSig = computeDocSignature(doc.content);

  const bigramScore = jaccardSimilarity(qSig.bigrams, dSig.bigrams);
  const trigramScore = jaccardSimilarity(qSig.trigrams, dSig.trigrams);
  const charScore = jaccardSimilarity(qSig.chars, dSig.chars);

  const titleBonus =
    doc.metadata.h2 && query.includes(doc.metadata.h2)
      ? 0.15
      : doc.metadata.h1 && query.includes(doc.metadata.h1)
        ? 0.1
        : 0;

  const domainBonus = query.includes(doc.metadata.domain) ? 0.1 : 0;

  return bigramScore * 0.35 + trigramScore * 0.35 + charScore * 0.3 + titleBonus + domainBonus;
}

// ========================================
// CRUD 操作
// ========================================

export async function addDocuments(docs: KnowledgeDocument[]): Promise<number> {
  const stored = loadDocuments();
  for (let i = 0; i < docs.length; i++) {
    stored.push({ id: `doc_${Date.now()}_${i}`, content: docs[i].pageContent, metadata: docs[i].metadata });
  }
  saveDocuments(stored);
  return docs.length;
}

export async function clearAll(): Promise<void> {
  if (fs.existsSync(DOCUMENTS_FILE)) fs.unlinkSync(DOCUMENTS_FILE);
  console.log("已清空所有数据");
}

export async function searchKnowledge(
  query: string,
  topK: number = config.retrievalTopK,
): Promise<KnowledgeDocument[]> {
  const stored = loadDocuments();
  if (stored.length === 0) return [];

  const vectorResults = stored
    .map((doc) => ({ doc, score: scoreRelevance(query, doc) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK * 2);

  if (config.enableHybridSearch) {
    const kwResults = keywordSearch(query, stored, topK * 2);
    const fused = rrfFuse(vectorResults, kwResults, topK, config.hybridSearchRrfK);
    return fused.map(
      (entry) => new Document<KnowledgeMetadata>({ pageContent: entry.doc.content, metadata: entry.doc.metadata }),
    );
  }

  return vectorResults
    .slice(0, topK)
    .map((entry) => new Document<KnowledgeMetadata>({ pageContent: entry.doc.content, metadata: entry.doc.metadata }));
}

export async function searchByDomain(
  query: string,
  domain: string,
  topK: number = config.retrievalTopK,
): Promise<KnowledgeDocument[]> {
  const stored = loadDocuments().filter((d) => d.metadata.domain === domain);
  if (stored.length === 0) return [];

  const vectorResults = stored
    .map((doc) => ({ doc, score: scoreRelevance(query, doc) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK * 2);

  if (config.enableHybridSearch) {
    const kwResults = keywordSearch(query, stored, topK * 2);
    const fused = rrfFuse(vectorResults, kwResults, topK, config.hybridSearchRrfK);
    return fused.map(
      (entry) => new Document<KnowledgeMetadata>({ pageContent: entry.doc.content, metadata: entry.doc.metadata }),
    );
  }

  return vectorResults
    .slice(0, topK)
    .map((entry) => new Document<KnowledgeMetadata>({ pageContent: entry.doc.content, metadata: entry.doc.metadata }));
}

export async function getDocumentCount(): Promise<number> {
  return loadDocuments().length;
}

export async function listCollections(): Promise<string[]> {
  return loadDocuments().length > 0 ? [config.chromaCollectionName] : [];
}

export async function addDocumentsBatched(docs: KnowledgeDocument[], batchSize = 100): Promise<number> {
  let total = 0;
  for (let i = 0; i < docs.length; i += batchSize) {
    const count = await addDocuments(docs.slice(i, i + batchSize));
    total += count;
    console.log(`  进度: ${total}/${docs.length}`);
  }
  return total;
}
