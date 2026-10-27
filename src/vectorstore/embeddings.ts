/**
 * Embedding 实例管理
 *
 * 双提供方(由 config.embeddingProvider 选择):
 * - local(默认):@huggingface/transformers 运行 all-MiniLM-L6-v2,离线可用,
 *   模型缓存目录走 config.embeddingCacheDir(Docker 构建期预下载)
 * - api:OpenAI 兼容 embeddings API(复用 embeddingBaseUrl/embeddingApiKey)
 *
 * 切换 provider 会改变向量维度,必须重新 ingest,否则 ChromaDB 查询维度不匹配。
 *
 * 平台注记:transformers v4 在 Node 下强依赖 onnxruntime-node 原生绑定,
 * 而 ORT 1.24+ 不再发布 darwin/x64(macOS Intel)绑定;package.json overrides
 * 固定 onnxruntime-node@1.23.0(最后一个带 darwin/x64 的版本)兼容 Intel Mac,
 * 对 linux/arm64 无副作用。
 */

import { Embeddings } from "@langchain/core/embeddings";
import { OpenAIEmbeddings } from "@langchain/openai";
import { config } from "../config.js";
import { createLogger } from "../logger.js";

const log = createLogger("vectorstore:embeddings");

/** 单批推理的最大文本数(本地 CPU 推理,批过大反而内存压力) */
const EMBED_BATCH_SIZE = 16;
/** embedQuery 结果缓存上限(agent 多轮检索中重复查询零成本命中) */
const QUERY_CACHE_MAX = 500;

let _embeddings: Embeddings | null = null;

/** 底层模型类型（动态导入的 pipeline 结果） */
type FeatureExtractionPipeline = (
  input: string | string[],
  options?: Record<string, unknown>,
) => Promise<{ data: ArrayLike<number> }>;

/** transformers.js 运行环境(缓存目录/镜像源) */
type TransformerEnv = { cacheDir?: string; remoteHost?: string; remotePathTemplate?: string };

/**
 * 基于 @huggingface/transformers 的本地 Embedding 实现
 */
export class LocalEmbeddings extends Embeddings {
  private model: FeatureExtractionPipeline | null = null;
  private modelName: string;
  /**
   * 查询向量缓存(LRU:FIFO 淘汰,命中后刷新位置)
   *
   * agent 多轮检索中同一 query 会被 search_knowledge_base 重复触发;
   * 本地推理虽快,缓存依然是零成本的。
   */
  private queryCache = new Map<string, number[]>();

  constructor(modelName: string = config.embeddingModel) {
    super({});
    this.modelName = modelName;
  }

  private async getModel(): Promise<FeatureExtractionPipeline> {
    if (!this.model) {
      log.info({ model: this.modelName, cacheDir: config.embeddingCacheDir }, "Loading local embedding model...");
      const { pipeline, env } = await import("@huggingface/transformers");
      const transformersEnv = env as TransformerEnv;
      // 缓存目录显式固定:Docker 构建期预下载同一路径,运行时命中离线缓存
      transformersEnv.cacheDir = config.embeddingCacheDir;
      // 镜像源可配置(huggingface.co 访问受阻时切换)
      transformersEnv.remoteHost = config.hfMirror;
      transformersEnv.remotePathTemplate = "{model}/resolve/{revision}/";
      this.model = (await pipeline("feature-extraction", this.modelName, {
        // v4 起 quantized: true 改为 dtype: "q8"(8-bit 量化,体积/速度最优)
        dtype: "q8",
      })) as FeatureExtractionPipeline;
      log.info("Model loaded");
    }
    return this.model;
  }

  /**
   * 批量文本向量化
   *
   * pipeline 原生支持数组输入,整批一次 tokenize + 前向推理;
   * 返回数据为 [batch, dim] 展平形式,按 dim 切分还原。
   * (旧实现按 batch 切片后仍逐条调用,批处理形同虚设)
   */
  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const model = await this.getModel();

    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
      const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
      const output = await model(batch, { pooling: "mean", normalize: true });
      const data = Array.from(output.data);
      const dim = data.length / batch.length;

      if (!Number.isInteger(dim) || dim < 1 || typeof data[0] !== "number") {
        // 防御性回退:批量返回结构与 [batch, dim] 假设不符时退化为逐条推理。
        // 逐条模式是改造前的已知可用路径——正确性优先于吞吐。
        log.warn(
          { batchSize: batch.length, dataLength: data.length },
          "Batch output shape unexpected, sequential fallback",
        );
        for (const text of batch) {
          const single = await model(text, { pooling: "mean", normalize: true });
          results.push(Array.from(single.data));
        }
        continue;
      }

      for (let j = 0; j < batch.length; j++) {
        results.push(data.slice(j * dim, (j + 1) * dim));
      }
    }
    return results;
  }

  async embedQuery(text: string): Promise<number[]> {
    const cached = this.queryCache.get(text);
    if (cached) {
      // LRU:命中后移到队尾,避免热查询被 FIFO 淘汰
      this.queryCache.delete(text);
      this.queryCache.set(text, cached);
      return cached;
    }

    const [embedding] = await this.embedDocuments([text]);
    this.queryCache.set(text, embedding);
    while (this.queryCache.size > QUERY_CACHE_MAX) {
      const oldest = this.queryCache.keys().next().value;
      if (oldest === undefined) break;
      this.queryCache.delete(oldest);
    }
    return embedding;
  }
}

/**
 * 基于 OpenAI 兼容 API 的 Embedding 实现
 *
 * 维度由模型原生决定(text-embedding-3-small=1536);批量请求由 SDK 内部分批。
 * 向量维度与 local 提供方不同,切换后必须重新 ingest。
 */
export class ApiEmbeddings extends Embeddings {
  private inner: OpenAIEmbeddings;

  constructor() {
    super({});
    this.inner = new OpenAIEmbeddings({
      model: config.embeddingModel,
      apiKey: config.embeddingApiKey,
      configuration: {
        baseURL: config.embeddingBaseUrl,
      },
    });
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    return this.inner.embedDocuments(texts);
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.inner.embedQuery(text);
  }
}

/**
 * 获取或创建 Embeddings 实例(单例,按 config.embeddingProvider 选择实现)
 */
export function getEmbeddings(): Embeddings {
  if (!_embeddings) {
    _embeddings = config.embeddingProvider === "api" ? new ApiEmbeddings() : new LocalEmbeddings();
    log.info({ provider: config.embeddingProvider, model: config.embeddingModel }, "Embeddings initialized");
  }
  return _embeddings;
}

/**
 * 重置 Embeddings 实例
 */
export function resetEmbeddings(): void {
  _embeddings = null;
}
