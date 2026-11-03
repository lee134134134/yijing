/**
 * 全文语料加载器测试
 */

import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  dir: `/tmp/yijing-corpus-test-${process.pid}-${Date.now()}`,
}));

vi.mock("../config.js", () => ({
  config: { knowledgeDir: "/tmp", dataDir: "/tmp", includePrivate: false },
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { loadCorpusFiles, parseFrontMatter } from "../ingestion/corpus-loader.js";

beforeAll(() => {
  fs.mkdirSync(path.join(h.dir, "book-a"), { recursive: true });
  fs.writeFileSync(
    path.join(h.dir, "book-a", "001.md"),
    `---
book: 伤寒论
chapter: 辨太阳病
pageStart: 3
pageEnd: 5
sourcePdf: pdf/0611/shanghanlun.pdf
---
# 辨太阳病

太阳之为病，脉浮，头项强痛而恶寒。`,
    "utf-8",
  );
  fs.writeFileSync(
    path.join(h.dir, "book-a", "002.md"),
    `# 无 front-matter\n\n这是一段没有元数据的正文，用于验证回退逻辑。`,
    "utf-8",
  );
  fs.writeFileSync(
    path.join(h.dir, "book-a", "003.md"),
    `---\nbook: [unclosed\n---\n\n这段 YAML 非法，应回退为纯正文而不是崩溃。`,
    "utf-8",
  );
});

afterAll(() => {
  fs.rmSync(h.dir, { recursive: true, force: true });
});

describe("parseFrontMatter", () => {
  it("解析 front-matter 与正文", () => {
    const { data, body } = parseFrontMatter("---\nbook: 伤寒论\npageStart: 3\n---\n\n正文");
    expect(data.book).toBe("伤寒论");
    expect(data.pageStart).toBe(3);
    expect(body.trim()).toBe("正文");
  });

  it("无 front-matter 时原样返回正文", () => {
    const { data, body } = parseFrontMatter("纯正文");
    expect(data).toEqual({});
    expect(body).toBe("纯正文");
  });

  it("非法 YAML 回退为空元数据", () => {
    const { data, body } = parseFrontMatter("---\nbook: [unclosed\n---\n\n正文");
    expect(data).toEqual({});
    expect(body.trim()).toBe("正文");
  });
});

describe("loadCorpusFiles", () => {
  it("加载带 front-matter 的章节并映射元数据", () => {
    const docs = loadCorpusFiles(h.dir);
    expect(docs).toHaveLength(3);

    const first = docs.find((doc) => doc.metadata.source === "book-a/001.md");
    expect(first?.metadata).toMatchObject({
      book: "伤寒论",
      chapter: "辨太阳病",
      pageStart: 3,
      pageEnd: 5,
      layer: "fulltext",
      h1: "伤寒论",
      h2: "辨太阳病",
    });
    expect(first?.pageContent).toContain("太阳之为病");
  });

  it("无 front-matter 时用目录名作为 book", () => {
    const docs = loadCorpusFiles(h.dir);
    const second = docs.find((doc) => doc.metadata.source === "book-a/002.md");
    expect(second?.metadata.book).toBe("book-a");
    expect(second?.metadata.layer).toBe("fulltext");
  });

  it("目录不存在时返回空数组", () => {
    expect(loadCorpusFiles(path.join(h.dir, "missing"))).toEqual([]);
  });
});
