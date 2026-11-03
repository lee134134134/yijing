/**
 * 索引清单测试
 *
 * 验证写入/读取/配置一致性校验,防止"换模型未重建索引"静默发生。
 */

import fs from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  dataDir: `/tmp/yijing-manifest-test-${process.pid}`,
}));

vi.mock("../config.js", () => ({
  config: {
    dataDir: h.dataDir,
    chromaCollectionName: "test_collection",
    embeddingProvider: "local",
    embeddingModel: "Xenova/bge-small-zh-v1.5",
    embeddingDimension: 512,
    chunkSize: 800,
    chunkOverlap: 150,
  },
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { config } from "../config.js";
import type { KnowledgeDocument } from "../types.js";
import { checkManifest, computeCorpusHash, readManifest, writeManifest } from "../vectorstore/manifest.js";

const baseManifest = {
  collection: "test_collection",
  embeddingProvider: "local" as const,
  embeddingModel: "Xenova/bge-small-zh-v1.5",
  embeddingDimension: 512,
  chunkSize: 800,
  chunkOverlap: 150,
  corpusHash: "abc123",
  chunkCount: 10,
};

describe("index manifest", () => {
  beforeEach(() => {
    fs.rmSync(h.dataDir, { recursive: true, force: true });
    fs.mkdirSync(h.dataDir, { recursive: true });
    // 恢复被单个用例修改的配置
    const mutable = config as {
      embeddingModel: string;
      embeddingDimension: number;
      chunkSize: number;
      chunkOverlap: number;
      chromaCollectionName: string;
    };
    mutable.embeddingModel = "Xenova/bge-small-zh-v1.5";
    mutable.embeddingDimension = 512;
    mutable.chunkSize = 800;
    mutable.chunkOverlap = 150;
    mutable.chromaCollectionName = "test_collection";
  });

  afterAll(() => {
    fs.rmSync(h.dataDir, { recursive: true, force: true });
  });

  it("写入后可读取", () => {
    writeManifest(baseManifest);
    const manifest = readManifest();
    expect(manifest?.embeddingModel).toBe(baseManifest.embeddingModel);
    expect(manifest?.version).toBe(1);
    expect(manifest?.builtAt).toBeTruthy();
  });

  it("缺失清单时校验失败", () => {
    const result = checkManifest();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("索引清单缺失");
  });

  it("配置一致时校验通过", () => {
    writeManifest(baseManifest);
    expect(checkManifest().ok).toBe(true);
  });

  it("embedding 模型变化 → 校验失败并提示重新 ingest", () => {
    writeManifest(baseManifest);
    (config as { embeddingModel: string }).embeddingModel = "Xenova/all-MiniLM-L6-v2";
    const result = checkManifest();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("embedding 模型");
    expect(result.error).toContain("npm run ingest");
  });

  it("分块参数变化 → 校验失败", () => {
    writeManifest(baseManifest);
    (config as { chunkSize: number }).chunkSize = 1000;
    const result = checkManifest();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("chunk size");
  });

  it("语料哈希与文件顺序无关", () => {
    const docs: KnowledgeDocument[] = [
      { pageContent: "A", metadata: { source: "a.md", domain: "x" } },
      { pageContent: "B", metadata: { source: "b.md", domain: "x" } },
    ];
    expect(computeCorpusHash(docs)).toBe(computeCorpusHash([docs[1]!, docs[0]!]));
    expect(computeCorpusHash(docs)).not.toBe(computeCorpusHash([{ ...docs[0]!, pageContent: "C" }]));
  });
});
