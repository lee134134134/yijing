/**
 * FTS5 全文索引测试
 *
 * 使用临时 SQLite 文件,验证中文 bigram 分词、BM25 排序与重建/清空。
 */

import fs from "node:fs";
import { Document } from "@langchain/core/documents";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  dbPath: `/tmp/yijing-fts-test-${process.pid}-${Date.now()}.db`,
}));

vi.mock("../config.js", () => ({
  config: { ftsDbPath: h.dbPath, dataDir: "/tmp" },
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import type { KnowledgeDocument } from "../types.js";
import { clearFts, closeFts, countFts, rebuildFts, searchFts, tokenizeForFts } from "../vectorstore/fts.js";

function doc(content: string, source: string, h2?: string): KnowledgeDocument {
  return new Document({ pageContent: content, metadata: { source, domain: "伤寒论", h2 } }) as KnowledgeDocument;
}

const docs = [
  doc("桂枝汤方：桂枝三两，芍药三两，甘草二两，生姜三两，大枣十二枚。主治太阳中风。", "shanghanlun.md", "桂枝汤"),
  doc("麻黄汤主治太阳伤寒，症见恶寒发热、无汗而喘。", "shanghanlun.md", "麻黄汤"),
  doc("足三里位于犊鼻下三寸，胫骨前缘外一横指。", "zhenjiu.md", "足三里"),
];

describe("tokenizeForFts", () => {
  it("中文按 bigram 切分", () => {
    expect(tokenizeForFts("桂枝汤")).toBe("桂枝 枝汤");
  });

  it("拉丁/数字按单词切分并小写", () => {
    expect(tokenizeForFts("Li Zhong 123")).toBe("li zhong 123");
  });

  it("混合文本保留中英文", () => {
    const tokens = tokenizeForFts("桂枝汤 Li Zhong");
    expect(tokens).toContain("桂枝");
    expect(tokens).toContain("li");
  });
});

describe("FTS 索引与检索", () => {
  beforeEach(async () => {
    closeFts();
    fs.rmSync(h.dbPath, { force: true });
    fs.rmSync(`${h.dbPath}-wal`, { force: true });
    fs.rmSync(`${h.dbPath}-shm`, { force: true });
    await rebuildFts(docs);
  });

  afterAll(() => {
    closeFts();
    fs.rmSync(h.dbPath, { force: true });
    fs.rmSync(`${h.dbPath}-wal`, { force: true });
    fs.rmSync(`${h.dbPath}-shm`, { force: true });
  });

  it("中文查询命中正确文档", async () => {
    const hits = await searchFts("桂枝汤", 5);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.pageContent).toContain("桂枝汤方");
    expect(hits[0]?.metadata.source).toBe("shanghanlun.md");
  });

  it("按 BM25 排序,支持多词 OR 召回", async () => {
    const hits = await searchFts("麻黄 伤寒", 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.pageContent).toContain("麻黄汤");
  });

  it("穴位文本可检索", async () => {
    const hits = await searchFts("足三里", 5);
    expect(hits[0]?.metadata.source).toBe("zhenjiu.md");
  });

  it("countFts 返回索引条数", async () => {
    expect(await countFts()).toBe(3);
  });

  it("clearFts 清空索引", async () => {
    await clearFts();
    expect(await countFts()).toBe(0);
    expect(await searchFts("桂枝汤", 5)).toEqual([]);
  });
});
