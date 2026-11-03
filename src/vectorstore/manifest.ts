/**
 * 索引清单(index manifest)
 *
 * 记录建索引时的 embedding 模型/维度/分块参数/语料哈希/文档数。
 * 目的:避免"换了 embedding 模型或分块参数但没重建索引"导致
 * 维度不匹配或语义空间不一致,最终表现为"检索总是为空"。
 *
 * 清单与 ChromaDB 集合分离存放(data/index-manifest.json),由 ingest 写入;
 * 启动/查询前校验,不一致时 fail fast 并提示重新 ingest。
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { createLogger } from "../logger.js";
import type { KnowledgeDocument } from "../types.js";

const log = createLogger("vectorstore:manifest");

export interface IndexManifest {
  version: 1;
  collection: string;
  embeddingProvider: "local" | "api";
  embeddingModel: string;
  embeddingDimension: number;
  chunkSize: number;
  chunkOverlap: number;
  /** 语料内容哈希(前 16 位),用于判断是否需要重建 */
  corpusHash: string;
  chunkCount: number;
  builtAt: string;
}

export interface ManifestCheck {
  ok: boolean;
  error?: string;
  manifest?: IndexManifest;
}

const MANIFEST_FILE = "index-manifest.json";

/** 清单路径(运行时解析,避免测试/未配置 dataDir 时在模块加载阶段抛错) */
function manifestPath(): string {
  return path.join(config.dataDir ?? "./data", MANIFEST_FILE);
}

/** 读取清单;不存在或损坏返回 null */
export function readManifest(): IndexManifest | null {
  try {
    const file = manifestPath();
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as IndexManifest;
    if (parsed.version !== 1) {
      log.warn({ version: parsed.version }, "Unsupported index manifest version");
      return null;
    }
    return parsed;
  } catch (err) {
    log.warn({ err }, "Failed to read index manifest");
    return null;
  }
}

/** 原子写入清单 */
export function writeManifest(input: Omit<IndexManifest, "version" | "builtAt"> & { builtAt?: string }): IndexManifest {
  const manifest: IndexManifest = {
    version: 1,
    builtAt: input.builtAt ?? new Date().toISOString(),
    ...input,
  };
  const file = manifestPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
  fs.renameSync(tmp, file);
  log.info({ path: file, chunkCount: manifest.chunkCount }, "Index manifest written");
  return manifest;
}

/** 语料内容哈希(与文件顺序无关) */
export function computeCorpusHash(docs: KnowledgeDocument[]): string {
  const hash = createHash("sha256");
  const sorted = [...docs].sort((a, b) => a.metadata.source.localeCompare(b.metadata.source));
  for (const doc of sorted) {
    hash.update(doc.metadata.source);
    hash.update("\u0000");
    hash.update(doc.pageContent);
    hash.update("\u0000");
  }
  return hash.digest("hex").slice(0, 16);
}

/**
 * 校验清单与当前运行配置是否一致
 *
 * 缺清单视为不可用:老索引没有清单,无法证明是用当前模型建的,
 * 且 P0 修复了分块逻辑,必须重建一次。
 */
export function checkManifest(): ManifestCheck {
  const manifest = readManifest();
  if (!manifest) {
    return { ok: false, error: "索引清单缺失，请重新运行 npm run ingest" };
  }

  const mismatches: string[] = [];
  if (manifest.collection !== config.chromaCollectionName) {
    mismatches.push(`集合 ${manifest.collection} ≠ ${config.chromaCollectionName}`);
  }
  if (manifest.embeddingProvider !== config.embeddingProvider) {
    mismatches.push(`embedding provider ${manifest.embeddingProvider} ≠ ${config.embeddingProvider}`);
  }
  if (manifest.embeddingModel !== config.embeddingModel) {
    mismatches.push(`embedding 模型 ${manifest.embeddingModel} ≠ ${config.embeddingModel}`);
  }
  if (manifest.embeddingDimension !== config.embeddingDimension) {
    mismatches.push(`向量维度 ${manifest.embeddingDimension} ≠ ${config.embeddingDimension}`);
  }
  if (manifest.chunkSize !== config.chunkSize) {
    mismatches.push(`chunk size ${manifest.chunkSize} ≠ ${config.chunkSize}`);
  }
  if (manifest.chunkOverlap !== config.chunkOverlap) {
    mismatches.push(`chunk overlap ${manifest.chunkOverlap} ≠ ${config.chunkOverlap}`);
  }

  if (mismatches.length > 0) {
    return {
      ok: false,
      error: `索引与当前配置不一致（${mismatches.join("；")}），请重新运行 npm run ingest`,
      manifest,
    };
  }

  return { ok: true, manifest };
}
