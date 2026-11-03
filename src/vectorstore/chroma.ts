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
import { ChromaClient, type Collection, type Where } from "chromadb";
import { config } from "../config.js";
import { StoreError, VectorStoreError } from "../errors.js";
import { createLogger } from "../logger.js";
import type { KnowledgeDocument, KnowledgeMetadata } from "../types.js";
import { getEmbeddings } from "./embeddings.js";

const log = createLogger("vectorstore:chroma");

/** 检索结果缓存上限(知识库 ingest 后为静态数据,重复查询零成本命中) */
const SEARCH_CACHE_MAX = 100;
/**
 * searchKnowledge 结果缓存(key = `${topK}:${query}`,LRU)
 *
 * ingest 是唯一的写入口,addDocumentsBatched / clearAll / resetStore 会显式失效;
 * 缓存仅共享 Document 的只读视图(pageContent/metadata),调用方不得修改。
 */
const searchCache = new Map<string, KnowledgeDocument[]>();

/** 检索缓存 key */
function searchCacheKey(query: string, topK: number): string {
  return `${topK}:${query}`;
}

/** 写入检索缓存并做 LRU 淘汰 */
function cacheSearchResult(key: string, docs: KnowledgeDocument[]): void {
  searchCache.set(key, docs);
  while (searchCache.size > SEARCH_CACHE_MAX) {
    const oldest = searchCache.keys().next().value;
    if (oldest === undefined) break;
    searchCache.delete(oldest);
  }
}

/** 知识库内容变更后失效检索缓存(ingest / clearAll / resetStore) */
function invalidateSearchCache(): void {
  searchCache.clear();
}

// ========================================
// 连接管理(单例)
// ========================================

/** ChromaDB metadata filter */
type WhereFilter = Where;

let _client: ChromaClient | null = null;
let _collection: Collection | null = null;

/** 就绪检查缓存:避免每个请求都打 3 次 Chroma(5s 内复用) */
const HEALTH_TTL_MS = 5_000;
let _healthCache: { at: number; ok: boolean; error?: string } | null = null;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function invalidateHealthCache(): void {
  _healthCache = null;
}

/** ChromaDB metadata 仅支持标量类型 */
function toScalarMetadata(meta: KnowledgeMetadata): Record<string, string> {
  return Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined && v !== null)) as Record<
    string,
    string
  >;
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
 * 获取集合
 *
 * - create=true:写入路径,不存在则创建
 * - create=false:读取路径,不存在直接抛错,避免"自动建空集合 → 永远查不到"
 */
async function getCollection(create: boolean = true): Promise<Collection> {
  if (_collection) return _collection;

  const client = getClient();
  if (create) {
    _collection = await client.getOrCreateCollection({
      name: config.chromaCollectionName,
    });
    return _collection;
  }

  try {
    _collection = await client.getCollection({ name: config.chromaCollectionName });
    return _collection;
  } catch (err) {
    throw new VectorStoreError(`知识库集合 "${config.chromaCollectionName}" 不存在，请先运行 npm run ingest 构建索引`, {
      cause: err,
    });
  }
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
  const cacheKey = searchCacheKey(query, topK);
  const cached = searchCache.get(cacheKey);
  if (cached) {
    // LRU:命中后刷新位置
    searchCache.delete(cacheKey);
    searchCache.set(cacheKey, cached);
    return cached;
  }

  try {
    const collection = await getCollection(false);
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
    cacheSearchResult(cacheKey, docs);
    return docs;
  } catch (err) {
    log.error({ err, query }, "Search failed");
    if (err instanceof VectorStoreError) throw err;
    throw new VectorStoreError("知识库检索失败，请确认 ChromaDB 与索引状态", {
      cause: err,
      details: { query },
    });
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
    const collection = await getCollection(false);
    const queryEmbedding = await getEmbeddings().embedQuery(query);
    const filter: WhereFilter = { domain: { $eq: domain } } as WhereFilter;
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
    if (err instanceof VectorStoreError) throw err;
    throw new VectorStoreError("知识库领域检索失败，请确认 ChromaDB 与索引状态", {
      cause: err,
      details: { query, domain },
    });
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
function rrfFuse(entries: KnowledgeDocument[][], topK: number, k: number = 60): KnowledgeDocument[] {
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
    const allResults = await Promise.all(queries.map((q) => searchKnowledge(q, topK * 2)));
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
export async function addDocumentsBatched(docs: KnowledgeDocument[], batchSize: number = 50): Promise<number> {
  if (docs.length === 0) return 0;

  try {
    const collection = await getCollection();
    let total = 0;
    for (let i = 0; i < docs.length; i += batchSize) {
      const batch = docs.slice(i, i + batchSize);
      const embeddings = await getEmbeddings().embedDocuments(batch.map((d) => d.pageContent));
      const ids = batch.map((_, j) => `doc_${Date.now()}_${i + j}_${Math.random().toString(36).slice(2, 8)}`);
      await collection.add({
        ids,
        embeddings,
        documents: batch.map((d) => d.pageContent),
        metadatas: batch.map((d) => toScalarMetadata(d.metadata)),
      });
      total += batch.length;
      log.info({ progress: `${total}/${docs.length}` }, "Batch written");
    }
    // 知识库内容变更,失效检索缓存与健康缓存
    invalidateSearchCache();
    invalidateHealthCache();
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
    const collection = await getCollection(false);
    return await collection.count();
  } catch (err) {
    log.error({ err }, "Failed to get document count");
    if (err instanceof VectorStoreError) throw err;
    throw new VectorStoreError("读取知识库文档数失败", { cause: err });
  }
}

/**
 * 列出 ChromaDB 中的所有集合
 *
 * 失败时抛错而非返回空数组:空数组会让 /status 显示"没有集合",
 * 与"Chroma 连不上"无法区分。
 */
export async function listCollections(): Promise<string[]> {
  try {
    const collections = await getClient().listCollections();
    return collections.map((c) => c.name);
  } catch (err) {
    throw new VectorStoreError("读取 ChromaDB 集合列表失败", { cause: err });
  }
}

/** 知识库健康状态(不抛错,供 /status 与 /ready 使用) */
export interface StoreHealth {
  ok: boolean;
  /** ChromaDB 服务是否可达 */
  chroma: boolean;
  /** 目标集合是否存在 */
  collection: boolean;
  docCount: number;
  collections: string[];
  error?: string;
}

/**
 * 探测知识库健康状态
 *
 * ok 的定义:服务可达 + 集合存在 + 至少有 1 个文档。
 * 集合为空视为"未构建索引",同样不是可用状态。
 */
export async function getStoreHealth(): Promise<StoreHealth> {
  try {
    await getClient().heartbeat();
  } catch (err) {
    return {
      ok: false,
      chroma: false,
      collection: false,
      docCount: 0,
      collections: [],
      error: errorMessage(err),
    };
  }

  try {
    const collections = await getClient().listCollections();
    const names = collections.map((c) => c.name);
    const exists = names.includes(config.chromaCollectionName);
    const docCount = exists ? await getDocumentCount() : 0;
    const ok = exists && docCount > 0;
    return {
      ok,
      chroma: true,
      collection: exists,
      docCount,
      collections: names,
      ...(ok
        ? {}
        : {
            error: exists
              ? "知识库为空，请运行 npm run ingest 构建索引"
              : `集合 "${config.chromaCollectionName}" 不存在，请运行 npm run ingest`,
          }),
    };
  } catch (err) {
    return {
      ok: false,
      chroma: true,
      collection: false,
      docCount: 0,
      collections: [],
      error: errorMessage(err),
    };
  }
}

/**
 * 查询前的就绪断言
 *
 * 在调用 LLM 之前快速失败,避免"知识库挂了但模型照样回答"。
 * 结果缓存 5s,正常请求的成本可忽略。
 */
export async function assertStoreReady(): Promise<void> {
  const now = Date.now();
  if (_healthCache && now - _healthCache.at < HEALTH_TTL_MS) {
    if (!_healthCache.ok) throw new VectorStoreError(_healthCache.error ?? "知识库当前不可用");
    return;
  }

  const health = await getStoreHealth();
  _healthCache = { at: now, ok: health.ok, ...(health.error ? { error: health.error } : {}) };
  if (!health.ok) {
    // 原始错误只进日志与 /ready,对外返回统一的可读文案
    log.error({ error: health.error, collection: health.collection }, "Knowledge store not ready");
    throw new VectorStoreError(
      health.collection
        ? "知识库当前不可用，请确认 ChromaDB 正在运行且索引已构建"
        : "知识库索引尚未就绪，请先运行 npm run ingest",
    );
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
    invalidateSearchCache();
    invalidateHealthCache();
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
  invalidateSearchCache();
  invalidateHealthCache();
}
