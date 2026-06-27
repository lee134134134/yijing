/**
 * 本地向量存储 — 基于字符 n-gram 的中文语义检索
 *
 * 原理：对中文文本计算字符级别 2-gram/3-gram 签名，
 * 通过 Jaccard 相似度实现语义检索，无需外部 Embedding 服务。
 *
 * 存储结构:
 *   data/
 *     documents.json  - 文档内容 + 元数据
 *
 * 可替换方案：当有 Embedding 服务可用时，只需替换相似度计算
 * （将 ngramSimilarity 替换为余弦相似度）
 */

import fs from "fs";
import path from "path";
import { Document } from "@langchain/core/documents";
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
// 相似度评分
// ========================================

function scoreRelevance(query: string, doc: StoredDocument): number {
  const qSig = computeQuerySignature(query);
  const dSig = computeDocSignature(doc.content);

  const bigramScore = jaccardSimilarity(qSig.bigrams, dSig.bigrams);
  const trigramScore = jaccardSimilarity(qSig.trigrams, dSig.trigrams);
  const charScore = jaccardSimilarity(qSig.chars, dSig.chars);

  const titleBonus =
    (doc.metadata.h2 && query.includes(doc.metadata.h2)) ? 0.15 :
    (doc.metadata.h1 && query.includes(doc.metadata.h1)) ? 0.1 : 0;

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
  query: string, topK: number = config.retrievalTopK
): Promise<KnowledgeDocument[]> {
  const stored = loadDocuments();
  if (stored.length === 0) return [];

  const scored = stored
    .map((doc) => ({ doc, score: scoreRelevance(query, doc) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored.map((entry) =>
    new Document<KnowledgeMetadata>({ pageContent: entry.doc.content, metadata: entry.doc.metadata })
  );
}

export async function searchByDomain(
  query: string, domain: string, topK: number = config.retrievalTopK
): Promise<KnowledgeDocument[]> {
  const stored = loadDocuments().filter((d) => d.metadata.domain === domain);
  if (stored.length === 0) return [];

  return stored
    .map((doc) => ({ doc, score: scoreRelevance(query, doc) }))
    .sort((a, b) => b.score - a.score)
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
