/**
 * 向量存储 — ChromaDB + Embedding 语义检索
 *
 * 直接使用 chromadb JS 客户端(3.5.0)连接本地或远程 ChromaDB 服务,
 * 通过本地 Embedding 模型将文档转换为向量,实现语义检索。
 *
 * 架构变化 (v3.0.0 - DeepAgent.js 迁移):
 * - 移除 @langchain/community Chroma vectorstore 依赖(LangChain 1.x 不再提供)
 * - 改为 ChromaClient 直连:embed → query → 解析,接口完全自控
 * - 保留相同导出 API,下游调用方无需修改
 *
 * 依赖服务:
 *   ChromaDB HTTP 服务(默认 http://127.0.0.1:8000)
 *   可通过 docker-compose 启动
 */

import { Document } from "@langchain/core/documents";
import { ChromaClient, type Collection } from "chromadb";
import { config } from "../config.js";
import { StoreError } from "../errors.js";
import { createLogger } from "../logger.js";
import type { KnowledgeDocument, KnowledgeMetadata } from "../types.js";
import { getEmbeddings } from "./embeddings.js";

const log = createLogger("vectorstore:chroma");

// ========================================
// 连接管理(单例)
// ========================================

/** ChromaDB metadata filter (Where type) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WhereFilter = Record<string, any>;

let _client: ChromaClient | null = null;
let _collection: Collection | null = null;
let _collectionInitialized = false;

/** ChromaDB metadata 仅支持标量类型 */
function toScalarMetadata(meta: KnowledgeMetadata): Record<string, string> {
  return Object.fromEntries(
    Object.entries(meta).filter(([, v]) => v !== undefined && v !== null),
  ) as Record<string, string>;
}

/**
 * 获取或创建 ChromaDB 客户端(单例)
 */
function getClient(): ChromaClient {
  if (!_client) {
    const url = new URL(config.chromaDbUrl);
    _client = new ChromaClient({
      host: url.hostname,
      port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
      ssl: url.protocol === "https:",
    });
    log.info({ url: config.chromaDbUrl, collection: config.chromaCollectionName }, "Connecting to ChromaDB");
  }
  return _client;
}

/**
 * 获取或创建集合(单例,不存在则自动创建)
 */
async function getCollection(): Promise<Collection> {
  if (!_collection) {
    _collection = await getClient().getOrCreateCollection({
      name: config.chromaCollectionName,
    });
    _collectionInitialized = true;
  }
  return _collection;
}

/**
 * 解析 ChromaDB query 返回,重建 KnowledgeDocument 列表
 */
function parseQueryResult(result: Awaited<ReturnType<Collection["query"]>>): KnowledgeDocument[] {
  const docs = result.documents?.[0] ?? [];
  const metas = result.metadatas?.[0] ?? [];
  return docs.map((pageContent, i) => {
    const meta = (metas[i] ?? {}) as Record<string, unknown>;
    return new Document<KnowledgeMetadata>({
      pageContent: pageContent ?? "",
      metadata: {
        source: String(meta.source ?? ""),
        domain: String(meta.domain ?? ""),
        h1: meta.h1 ? String(meta.h1) : undefined,
        h2: meta.h2 ? String(meta.h2) : undefined,
        h3: meta.h3 ? String(meta.h3) : undefined,
        lineRange: meta.lineRange ? String(meta.lineRange) : undefined,
      },
    });
  });
}

// ========================================
// 检索操作
// ========================================

/**
 * 语义搜索知识库
 *
 * 使用 Embedding 将查询转为向量,在 ChromaDB 中执行余弦相似度搜索。
 * 返回按相关度降序排列的知识文档列表。
 */
export async function searchKnowledge(
  query: string,
  topK: number = config.retrievalTopK,
): Promise<KnowledgeDocument[]> {
  try {
    const collection = await getCollection();
    const queryEmbedding = await getEmbeddings().embedQuery(query);
    const result = await collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: topK,
      include: ["documents", "metadatas"],
    });

    const docs = parseQueryResult(result);
    if (docs.length === 0) {
      log.debug({ query }, "No results found");
      return [];
    }

    log.debug({ query, results: docs.length }, "Search completed");
    return docs;
  } catch (err) {
    log.error({ err, query }, "Search failed");
    // 降级:返回空结果,由调用方处理
    return [];
  }
}

/**
 * 按领域搜索
 *
 * 通过 ChromaDB 的 metadata 过滤,仅搜索指定领域的文档。
 * 领域值由 ingestion 阶段的 inferDomain() 设置。
 */
export async function searchByDomain(
  query: string,
  domain: string,
  topK: number = config.retrievalTopK,
): Promise<KnowledgeDocument[]> {
  try {
    const collection = await getCollection();
    const queryEmbedding = await getEmbeddings().embedQuery(query);
    const filter: WhereFilter = { domain: { $eq: domain } };
    const result = await collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: topK,
      where: filter,
      include: ["documents", "metadatas"],
    });

    const docs = parseQueryResult(result);
    if (docs.length === 0) {
      log.debug({ query, domain }, "No domain results found");
      return [];
    }

    return docs;
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
 * 仅使用文档在各结果列表中的排名位置计算融合得分(不依赖原始相似度分数),
 * 使多路检索结果的排序更鲁棒。
 *
 * RRF score = Σ 1/(k + rank),其中 rank 从 0 开始。
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
 * 批量添加文档(由 ingestion 使用)
 *
 * 每批次写入后记录进度。使用本地 Embedding 生成向量后直连 ChromaDB 写入。
 */
export async function addDocumentsBatched(
  docs: KnowledgeDocument[],
  batchSize: number = 50,
): Promise<number> {
  if (docs.length === 0) return 0;

  try {
    const collection = await getCollection();
    let total = 0;
    for (let i = 0; i < docs.length; i += batchSize) {
      const batch = docs.slice(i, i + batchSize);
      const embeddings = await getEmbeddings().embedDocuments(batch.map((d) => d.pageContent));
      const ids = batch.map(
        (_, j) => `doc_${Date.now()}_${i + j}_${Math.random().toString(36).slice(2, 8)}`,
      );
      await collection.add({
        ids,
        embeddings,
        documents: batch.map((d) => d.pageContent),
        metadatas: batch.map((d) => toScalarMetadata(d.metadata)),
      });
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
 * 添加单个批次(向下兼容,供 ingestion/index.ts 使用)
 */
export async function addDocuments(docs: KnowledgeDocument[]): Promise<number> {
  return addDocumentsBatched(docs, docs.length);
}

// ========================================
// 集合管理
// ========================================

/**
 * 获取文档总数
 */
export async function getDocumentCount(): Promise<number> {
  try {
    const collection = await getCollection();
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
    const collections = await getClient().listCollections();
    return collections.map((c) => c.name);
  } catch {
    return [];
  }
}

/**
 * 清空集合
 *
 * 删除集合(及其中所有文档和向量)。
 */
export async function clearAll(): Promise<void> {
  try {
    await getClient().deleteCollection({ name: config.chromaCollectionName });
    _collection = null;
    _collectionInitialized = false;
    log.info("Collection deleted");
  } catch (err) {
    log.error({ err }, "Failed to clear collection");
    if (err instanceof StoreError) throw err;
    throw new StoreError("清空集合失败", { cause: err });
  }
}

/**
 * 重置连接(配置变更后使用)
 */
export function resetStore(): void {
  _client = null;
  _collection = null;
  _collectionInitialized = false;
}
