/**
 * 向量存储 — ChromaDB + Embedding 语义检索
 *
 * 使用 @langchain/community Chroma 客户端，连接本地或远程 ChromaDB 服务，
 * 通过 OpenAI Embedding 模型将文档转换为向量，实现语义检索。
 *
 * 架构变化 (v2.0.0):
 * - 移除 n-gram Jaccard 本地检索（由 ChromaDB 向量检索替代）
 * - 移除 MiniSearch BM25 全文索引（可选后续层叠混合搜索）
 * - 新增真实 Embedding（text-embedding-3-small）
 * - 保留相同导出 API，下游调用方无需修改
 *
 * 依赖服务:
 *   ChromaDB HTTP 服务（默认 http://127.0.0.1:8000）
 *   可通过 docker-compose 启动
 */

import { Chroma } from "@langchain/community/vectorstores/chroma";
import { ChromaClient } from "chromadb";
import { config } from "../config.js";
import { RetrievalError, StoreError } from "../errors.js";
import { createLogger } from "../logger.js";
import type { KnowledgeDocument } from "../types.js";
import { getEmbeddings } from "./embeddings.js";

const log = createLogger("vectorstore:chroma");

// ========================================
// 连接管理（单例）
// ========================================

/** ChromaDB metadata filter (Where type) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WhereFilter = Record<string, any>;

let _store: Chroma | null = null;
let _collectionInitialized = false;

/**
 * 获取或创建 ChromaDB 连接
 */
async function getStore(): Promise<Chroma> {
  if (!_store) {
    log.info({ url: config.chromaDbUrl, collection: config.chromaCollectionName }, "Connecting to ChromaDB");
    _store = await Chroma.fromExistingCollection(getEmbeddings(), {
      collectionName: config.chromaCollectionName,
      url: config.chromaDbUrl,
    });
    _collectionInitialized = true;
  }
  return _store;
}

/**
 * 确认集合存在，若不存在则创建
 */
async function ensureCollection(): Promise<Chroma> {
  if (_collectionInitialized) return getStore();

  try {
    return await getStore();
  } catch {
    // 集合不存在，用空文档创建
    log.info("Collection not found, creating...");
    _store = await Chroma.fromDocuments([], getEmbeddings(), {
      collectionName: config.chromaCollectionName,
      url: config.chromaDbUrl,
    });
    _collectionInitialized = true;
    return _store;
  }
}

// ========================================
// 检索操作
// ========================================

/**
 * 语义搜索知识库
 *
 * 使用 Embedding 将查询转为向量，在 ChromaDB 中执行余弦相似度搜索。
 * 返回按相关度降序排列的知识文档列表。
 */
export async function searchKnowledge(
  query: string,
  topK: number = config.retrievalTopK,
): Promise<KnowledgeDocument[]> {
  try {
    const store = await getStore();
    const results = await store.similaritySearchWithScore(query, topK);

    if (results.length === 0) {
      log.debug({ query }, "No results found");
      return [];
    }

    log.debug({ query, results: results.length }, "Search completed");
    return results.map(([doc]) => doc as KnowledgeDocument);
  } catch (err) {
    log.error({ err, query }, "Search failed");
    // 降级：返回空结果，由调用方处理
    return [];
  }
}

/**
 * 按领域搜索
 *
 * 通过 ChromaDB 的 metadata 过滤，仅搜索指定领域的文档。
 * 领域值由 ingestion 阶段的 inferDomain() 设置。
 */
export async function searchByDomain(
  query: string,
  domain: string,
  topK: number = config.retrievalTopK,
): Promise<KnowledgeDocument[]> {
  try {
    const store = await getStore();
    const filter: WhereFilter = { domain: { $eq: domain } };
    const results = await store.similaritySearchWithScore(query, topK, filter);

    if (results.length === 0) {
      log.debug({ query, domain }, "No domain results found");
      return [];
    }

    return results.map(([doc]) => doc as KnowledgeDocument);
  } catch (err) {
    log.error({ err, query, domain }, "Domain search failed");
    return [];
  }
}

// ========================================
// 多查询融合检索
// ========================================

/**
 * 基于排名的 Reciprocal Rank Fusion
 *
 * 仅使用文档在各结果列表中的排名位置计算融合得分（不依赖原始相似度分数），
 * 使多路检索结果的排序更鲁棒。
 *
 * RRF score = Σ 1/(k + rank)，其中 rank 从 0 开始。
 */
function rrfFuse(
  entries: KnowledgeDocument[][],
  topK: number,
  k: number = 60,
): KnowledgeDocument[] {
  const fused = new Map<string, { doc: KnowledgeDocument; score: number }>();
  const seen = new Set<string>();

  for (const results of entries) {
    for (let rank = 0; rank < results.length; rank++) {
      const doc = results[rank]!;
      const id = `${doc.metadata.source ?? ""}:${doc.metadata.h2 ?? ""}:${doc.pageContent.slice(0, 80)}`;

      if (seen.has(id)) {
        const existing = fused.get(id);
        if (existing) existing.score += 1 / (k + rank);
        continue;
      }

      seen.add(id);
      fused.set(id, { doc, score: 1 / (k + rank) });
    }
  }

  return Array.from(fused.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((e) => e.doc);
}

/** 多查询融合检索 — 对多个查询分别检索后 RRF 融合 */
export async function multiQuerySearch(
  queries: string[],
  topK: number = config.retrievalTopK,
): Promise<KnowledgeDocument[]> {
  if (queries.length === 0) return [];
  if (queries.length === 1) return searchKnowledge(queries[0]!, topK);

  try {
    const allResults = await Promise.all(
      queries.map((q) => searchKnowledge(q, topK * 2)),
    );
    const fused = rrfFuse(allResults, topK);
    return fused;
  } catch (err) {
    log.error({ err, queries }, "Multi-query search failed, falling back to primary");
    return searchKnowledge(queries[0]!, topK);
  }
}

// ========================================
// 文档管理
// ========================================

/**
 * 批量添加文档（由 ingestion 使用）
 *
 * 每批次写入后记录进度。ChromaDB.fromDocuments 会自动生成 Embedding。
 */
export async function addDocumentsBatched(
  docs: KnowledgeDocument[],
  batchSize: number = 50,
): Promise<number> {
  if (docs.length === 0) return 0;

  try {
    // 首次写入：通过 fromDocuments 创建集合
    if (!_collectionInitialized) {
      log.info({ count: docs.length, batchSize }, "Creating collection with documents");
      _store = await Chroma.fromDocuments(docs, getEmbeddings(), {
        collectionName: config.chromaCollectionName,
        url: config.chromaDbUrl,
      });
      _collectionInitialized = true;
      log.info({ count: docs.length }, "Collection created");
      return docs.length;
    }

    // 后续写入：追加到已有集合
    const store = await getStore();
    let total = 0;
    for (let i = 0; i < docs.length; i += batchSize) {
      const batch = docs.slice(i, i + batchSize);
      await store.addDocuments(batch);
      total += batch.length;
      log.info({ progress: `${total}/${docs.length}` }, "Batch written");
    }
    return total;
  } catch (err) {
    log.error({ err }, "Failed to add documents");
    if (err instanceof StoreError) throw err;
    throw new StoreError("批量写入文档失败", { cause: err });
  }
}

/**
 * 添加单个批次（向下兼容，供 ingestion/index.ts 使用）
 */
export async function addDocuments(docs: KnowledgeDocument[]): Promise<number> {
  return addDocumentsBatched(docs, docs.length);
}

// ========================================
// 集合管理
// ========================================

/**
 * 获取文档总数（通过 ChromaClient 直连）
 */
export async function getDocumentCount(): Promise<number> {
  try {
    const client = new ChromaClient({ path: config.chromaDbUrl });
    const collection = await client.getCollection({ name: config.chromaCollectionName });
    if (!collection) return 0;
    return await collection.count();
  } catch (err) {
    log.error({ err }, "Failed to get document count");
    return 0;
  }
}

/**
 * 列出 ChromaDB 中的所有集合
 *
 * 用于 CLI/TUI/API 的知识库状态检查。
 */
export async function listCollections(): Promise<string[]> {
  try {
    const client = new ChromaClient({ path: config.chromaDbUrl });
    const collections = await client.listCollections();
    return collections.map((c: { name: string } | string) =>
      typeof c === "string" ? c : c.name,
    );
  } catch {
    return [];
  }
}

/**
 * 清空集合
 *
 * 删除集合（及其中所有文档和向量）。使用 ChromaClient 直连操作。
 */
export async function clearAll(): Promise<void> {
  try {
    const client = new ChromaClient({ path: config.chromaDbUrl });
    await client.deleteCollection({ name: config.chromaCollectionName });
    _store = null;
    _collectionInitialized = false;
    log.info("Collection deleted");
  } catch (err) {
    log.error({ err }, "Failed to clear collection");
    if (err instanceof StoreError) throw err;
    throw new StoreError("清空集合失败", { cause: err });
  }
}

/**
 * 重置连接（配置变更后使用）
 */
export function resetStore(): void {
  _store = null;
  _collectionInitialized = false;
}
