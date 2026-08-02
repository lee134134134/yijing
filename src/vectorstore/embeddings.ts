/**
 * Embedding 实例管理
 *
 * 使用本地 @xenova/transformers 运行 all-MiniLM-L6-v2 模型，
 * 完全离线运行，无外部 API 依赖。
 */

import { Embeddings } from "@langchain/core/embeddings";
import { createLogger } from "../logger.js";

const log = createLogger("vectorstore:embeddings");

let _embeddings: LocalEmbeddings | null = null;

/**
 * 基于 @xenova/transformers 的本地 Embedding 实现
 */
class LocalEmbeddings extends Embeddings {
  private model: any = null;
  private modelName: string;

  constructor(modelName: string = "Xenova/all-MiniLM-L6-v2") {
    super({});
    this.modelName = modelName;
  }

  private async getModel(): Promise<any> {
    if (!this.model) {
      log.info({ model: this.modelName }, "Downloading/loading HuggingFace model...");
      const { pipeline, env } = await import("@xenova/transformers");
      // Use HuggingFace mirror since huggingface.co is blocked in China
      env.remoteHost = "https://hf-mirror.com/";
      env.remotePathTemplate = "{model}/resolve/{revision}/";
      this.model = await pipeline("feature-extraction", this.modelName, {
        quantized: true,
      });
      log.info("Model loaded");
    }
    return this.model;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const model = await this.getModel();
    const results: number[][] = [];
    const batchSize = 10;
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      for (const text of batch) {
        const output = await model(text, { pooling: "mean", normalize: true });
        const embedding = Array.from(output.data) as number[];
        results.push(embedding);
      }
    }
    return results;
  }

  async embedQuery(text: string): Promise<number[]> {
    const results = await this.embedDocuments([text]);
    return results[0];
  }
}

/**
 * 获取或创建 Embeddings 实例（单例）
 */
export function getEmbeddings(): Embeddings {
  if (!_embeddings) {
    log.info("Initializing local embeddings (all-MiniLM-L6-v2)");
    _embeddings = new LocalEmbeddings();
  }
  return _embeddings;
}

/**
 * 重置 Embeddings 实例
 */
export function resetEmbeddings(): void {
  _embeddings = null;
}
