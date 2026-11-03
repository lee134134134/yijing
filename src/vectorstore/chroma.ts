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
import type { KnowledgeDocument, KnowledgeMetadata, RetrievedDocument } from "../types.js";
import { getEmbeddings } from "./embeddings.js";
import { clearFts, searchFts } from "./fts.js";
import { activeCollectionName, checkManifest, deleteManifest } from "./manifest.js";

const log = createLogger("vectorstore:chroma");

/** 检索结果缓存上限(知识库 ingest 后为静态数据,重复查询零成本命中) */
const SEARCH_CACHE_MAX = 100;
/**
 * searchKnowledge 结果缓存(key = `${topK}:${query}`,LRU)
 *
 * ingest 是唯一的写入口,addDocumentsBatched / clearAll / resetStore 会显式失效;
 * 缓存仅共享 Document 的只读视图(pageContent/metadata),调用方不得修改。
 */
const searchCache = new Map<string, RetrievedDocument[]>();

/** 检索缓存 key */
function searchCacheKey(query: string, topK: number): string {
  return `${topK}:${query}`;
}

/** 写入检索缓存并做 LRU 淘汰 */
function cacheSearchResult(key: string, docs: RetrievedDocument[]): void {
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
let _collectionName: string | null = null;

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
function toScalarMetadata(meta: KnowledgeMetadata): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(meta).filter(
      ([, v]) => v !== undefined && v !== null && (typeof v === "string" || typeof v === "number"),
    ),
  ) as Record<string, string | number>;
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
 * - create=true:写入路径,不存在则创建(cosine)
 * - create=false:读取路径,不存在直接抛错
 * - collectionName 默认取清单里的 active collection,支持 ingest 构建新版本
 */
async function getCollection(
  create: boolean = true,
  collectionName: string = activeCollectionName(),
): Promise<Collection> {
  if (_collection && _collectionName === collectionName) return _collection;

  const client = getClient();
  if (create) {
    _collection = await client.getOrCreateCollection({
      name: collectionName,
      // 统一使用 cosine:相似度阈值(1 - distance)才有明确语义
      configuration: { hnsw: { space: "cosine" } },
      // 我们始终传预计算 embedding,禁用默认 EF(否则会要求 @chroma-core/default-embed)
      embeddingFunction: null,
    });
    _collectionName = collectionName;
    return _collection;
  }

  try {
    // getCollection 的类型不接受 embeddingFunction:null(运行时会回退默认 EF),
    // 这里先确认存在,再用 getOrCreate 拿句柄并显式禁用默认 EF,避免误建空集合。
    const collections = await client.listCollections();
    if (!collections.some((collection) => collection.name === collectionName)) {
      throw new VectorStoreError(`知识库集合 "${collectionName}" 不存在，请先运行 npm run ingest 构建索引`);
    }
    _collection = await client.getOrCreateCollection({
      name: collectionName,
      configuration: { hnsw: { space: "cosine" } },
      embeddingFunction: null,
    });
    _collectionName = collectionName;
    return _collection;
  } catch (err) {
    if (err instanceof VectorStoreError) throw err;
    throw new VectorStoreError(`知识库集合 "${collectionName}" 不存在，请先运行 npm run ingest 构建索引`, {
      cause: err,
    });
  }
}

/**
 * 解析 ChromaDB query 返回,重建带相似度的 KnowledgeDocument 列表
 *
 * Chroma 返回 distance;集合使用 cosine 时 similarity = 1 - distance。
 */
function parseQueryResult(result: Awaited<ReturnType<Collection["query"]>>): RetrievedDocument[] {
  const docs = result.documents?.[0] ?? [];
  const metas = result.metadatas?.[0] ?? [];
  const distances = result.distances?.[0] ?? [];

  return docs.map((pageContent, i) => {
    const meta = (metas[i] ?? {}) as Record<string, unknown>;
    const doc = new Document<KnowledgeMetadata>({
      pageContent: pageContent ?? "",
      metadata: {
        source: String(meta.source ?? ""),
        domain: String(meta.domain ?? ""),
        h1: meta.h1 ? String(meta.h1) : undefined,
        h2: meta.h2 ? String(meta.h2) : undefined,
        h3: meta.h3 ? String(meta.h3) : undefined,
        lineRange: meta.lineRange ? String(meta.lineRange) : undefined,
        book: meta.book ? String(meta.book) : undefined,
        chapter: meta.chapter ? String(meta.chapter) : undefined,
        sectionPath: meta.sectionPath ? String(meta.sectionPath) : undefined,
        pageStart: typeof meta.pageStart === "number" ? meta.pageStart : undefined,
        pageEnd: typeof meta.pageEnd === "number" ? meta.pageEnd : undefined,
        layer: meta.layer === "curated" || meta.layer === "fulltext" ? meta.layer : undefined,
      },
    }) as RetrievedDocument;

    const distance = distances[i];
    if (typeof distance === "number" && Number.isFinite(distance)) {
      doc.score = Math.max(0, Math.min(1, 1 - distance));
    }
    return doc;
  });
}

// ========================================
// 检索操作
// ========================================

/**
 * 纯向量检索(带相似度阈值)
 */
async function denseSearch(query: string, topK: number, minScore: number): Promise<RetrievedDocument[]> {
  const collection = await getCollection(false);
  const queryEmbedding = await getEmbeddings().embedQuery(query);
  const result = await collection.query({
    queryEmbeddings: [queryEmbedding],
    nResults: topK,
    include: ["documents", "metadatas", "distances"],
  });

  const docs = parseQueryResult(result);
  return docs.filter((doc) => doc.score === undefined || doc.score >= minScore);
}

/**
 * 语义搜索知识库
 *
 * - dense:ChromaDB cosine 相似度,低于 minScore 丢弃
 * - hybrid(默认):追加 FTS5/BM25,经 RRF 融合
 * 向量库故障抛 VectorStoreError;FTS 故障只降级为 dense。
 */
export async function searchKnowledge(
  query: string,
  topK: number = config.retrievalTopK,
): Promise<RetrievedDocument[]> {
  const cacheKey = `${searchCacheKey(query, topK)}:${activeCollectionName()}:${config.minScore}:${config.enableHybrid ? "hybrid" : "dense"}`;
  const cached = searchCache.get(cacheKey);
  if (cached) {
    // LRU:命中后刷新位置
    searchCache.delete(cacheKey);
    searchCache.set(cacheKey, cached);
    return cached;
  }

  try {
    const candidateK = config.enableHybrid ? topK * 3 : topK;
    const dense = await denseSearch(query, candidateK, config.minScore);

    let docs: RetrievedDocument[] = dense.slice(0, topK);
    // 混合检索闸门:dense 完全无命中时不启用 FTS,避免通用词 bigram 造成假阳性
    if (config.enableHybrid && dense.length > 0) {
      let lexical: RetrievedDocument[] = [];
      try {
        lexical = await searchFts(query, candidateK);
      } catch (err) {
        log.warn({ err, query }, "FTS search failed, falling back to dense only");
      }
      if (lexical.length > 0) {
        docs = rrfFuse([dense, lexical], topK);
      }
    }

    if (docs.length === 0) {
      log.debug({ query, minScore: config.minScore }, "No results found");
      return [];
    }

    log.debug({ query, results: docs.length, hybrid: config.enableHybrid }, "Search completed");
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
): Promise<RetrievedDocument[]> {
  try {
    const collection = await getCollection(false);
    const queryEmbedding = await getEmbeddings().embedQuery(query);
    const filter: WhereFilter = { domain: { $eq: domain } } as WhereFilter;
    const result = await collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: topK,
      where: filter,
      include: ["documents", "metadatas", "distances"],
    });

    const docs = parseQueryResult(result).filter((doc) => doc.score === undefined || doc.score >= config.minScore);
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
function rrfFuse(entries: RetrievedDocument[][], topK: number, k: number = 60): RetrievedDocument[] {
  const fused = new Map<string, { doc: RetrievedDocument; score: number }>();
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
): Promise<RetrievedDocument[]> {
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
 * targetCollection 允许写入一个新版本集合(非破坏性 ingest):
 * 写入校验通过后再由 manifest 切换 active collection。
 */
export async function addDocumentsBatched(
  docs: KnowledgeDocument[],
  batchSize: number = 50,
  targetCollection: string = activeCollectionName(),
): Promise<number> {
  if (docs.length === 0) return 0;

  try {
    const collection = await getCollection(true, targetCollection);
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
      log.info({ progress: `${total}/${docs.length}`, collection: targetCollection }, "Batch written");
    }
    // 知识库内容变更,失效检索缓存与健康缓存
    invalidateSearchCache();
    invalidateHealthCache();
    // 写入的不是当前 active 集合时,不要把单例指向构建中的集合
    if (targetCollection !== activeCollectionName()) {
      _collection = null;
      _collectionName = null;
    }
    return total;
  } catch (err) {
    log.error({ err, collection: targetCollection }, "Failed to add documents");
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
export async function getDocumentCount(collectionName: string = activeCollectionName()): Promise<number> {
  try {
    const collection = await getCollection(false, collectionName);
    return await collection.count();
  } catch (err) {
    log.error({ err, collectionName }, "Failed to get document count");
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
  /** 当前 active 集合名(可能带版本后缀) */
  collectionName: string;
  /** ChromaDB 服务是否可达 */
  chroma: boolean;
  /** 目标集合是否存在 */
  collection: boolean;
  docCount: number;
  collections: string[];
  /** 索引清单校验结果 */
  manifest: { ok: boolean; error?: string };
  /** 用户可读的错误(可进 API 响应) */
  error?: string;
  /** 原始异常信息(仅用于 /ready 诊断与日志) */
  detail?: string;
}

/**
 * 探测知识库健康状态
 *
 * ok 的定义:服务可达 + 集合存在 + 至少有 1 个文档 + 索引清单与配置一致。
 */
export async function getStoreHealth(): Promise<StoreHealth> {
  const manifest = checkManifest();
  const manifestCheck = { ok: manifest.ok, ...(manifest.error ? { error: manifest.error } : {}) };
  const active = activeCollectionName();

  try {
    await getClient().heartbeat();
  } catch (err) {
    return {
      ok: false,
      collectionName: active,
      chroma: false,
      collection: false,
      docCount: 0,
      collections: [],
      manifest: manifestCheck,
      error: "无法连接 ChromaDB，请确认服务已启动",
      detail: errorMessage(err),
    };
  }

  try {
    const collections = await getClient().listCollections();
    const names = collections.map((c) => c.name);
    const exists = names.includes(active);
    const docCount = exists ? await getDocumentCount(active) : 0;

    const error = !exists
      ? `集合 "${active}" 不存在，请运行 npm run ingest`
      : docCount === 0
        ? "知识库为空，请运行 npm run ingest 构建索引"
        : !manifest.ok
          ? manifest.error
          : undefined;

    return {
      ok: exists && docCount > 0 && manifest.ok,
      collectionName: active,
      chroma: true,
      collection: exists,
      docCount,
      collections: names,
      manifest: manifestCheck,
      ...(error ? { error } : {}),
    };
  } catch (err) {
    return {
      ok: false,
      collectionName: active,
      chroma: true,
      collection: false,
      docCount: 0,
      collections: [],
      manifest: manifestCheck,
      error: "读取 ChromaDB 集合失败",
      detail: errorMessage(err),
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
    log.error({ error: health.error, detail: health.detail }, "Knowledge store not ready");
    throw new VectorStoreError(health.error ?? "知识库当前不可用");
  }
}

/**
 * 删除指定集合(ingest 切换后清理旧版本)
 */
export async function deleteCollectionByName(name: string): Promise<void> {
  await getClient().deleteCollection({ name });
  if (_collectionName === name) {
    _collection = null;
    _collectionName = null;
  }
  invalidateSearchCache();
  invalidateHealthCache();
  log.info({ collection: name }, "Collection deleted");
}

/**
 * 清空当前 active 集合与清单
 *
 * 手动重置用;ingest 已改为"写新集合 → 切清单",不再调用这里。
 */
export async function clearAll(): Promise<void> {
  try {
    const active = activeCollectionName();
    await deleteCollectionByName(active);
    deleteManifest();
    await clearFts();
    _collection = null;
    _collectionName = null;
    log.info({ collection: active }, "Collection cleared");
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
  _collectionName = null;
  invalidateSearchCache();
  invalidateHealthCache();
}
