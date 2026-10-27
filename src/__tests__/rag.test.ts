/**
 * RAG 模块单元测试
 *
 * 测试 query-rewriting、context-manager、citation 模块的核心逻辑。
 */

import { describe, expect, it } from "vitest";
import { buildCitedContext, formatCitations, parseCitations } from "../rag/citation.js";
import { estimateTokens, getContextBudget, trimDocsToBudget } from "../rag/context-manager.js";
import { cleanQuery } from "../rag/query-rewriting.js";
import type { KnowledgeDocument } from "../types.js";

// ── query-rewriting 测试 ──
describe("rag/query-rewriting", () => {
  describe("cleanQuery", () => {
    it("移除口语化前缀", () => {
      expect(cleanQuery("请问桂枝汤怎么用")).toBe("桂枝汤怎么用");
      expect(cleanQuery("我想知道风寒感冒")).toBe("风寒感冒");
      expect(cleanQuery("有没有头痛的偏方")).toBe("头痛的偏方");
    });

    it("去除问号后缀", () => {
      expect(cleanQuery("头痛怎么办？")).toBe("头痛怎么办");
    });

    it("无口语化前缀时原样返回", () => {
      expect(cleanQuery("桂枝汤组成")).toBe("桂枝汤组成");
    });
  });
});

// ── context-manager 测试 ──
describe("rag/context-manager", () => {
  describe("estimateTokens", () => {
    it("估算中文字符数约为1 token/字符", () => {
      const tokens = estimateTokens("一二三四五六七八九十");
      expect(tokens).toBeGreaterThanOrEqual(8);
      expect(tokens).toBeLessThanOrEqual(12);
    });

    it("英文单词估算较少 tokens", () => {
      const cnTokens = estimateTokens("一二三四五六七八九十");
      const enTokens = estimateTokens("hello world test");
      expect(cnTokens).toBeGreaterThan(enTokens);
    });

    it("空字符串返回 0", () => {
      expect(estimateTokens("")).toBe(0);
    });
  });

  describe("getContextBudget", () => {
    it("计算正确的上下文预算", () => {
      const budget = getContextBudget(2000, 4096);
      expect(budget).toBe(8192 - 2000 - 4096);
    });

    it("最小预算为 512", () => {
      const budget = getContextBudget(8000, 4096);
      expect(budget).toBe(512);
    });
  });

  describe("trimDocsToBudget", () => {
    it("保留适合预算的文档", () => {
      const docs = [
        { pageContent: "一二三四五六七八九十", metadata: { source: "test.md", domain: "test" } } as KnowledgeDocument,
        { pageContent: "一二三四五六七八九十", metadata: { source: "test2.md", domain: "test" } } as KnowledgeDocument,
      ];
      const result = trimDocsToBudget(docs, 100, 1500);
      expect(result.totalTokens).toBeLessThanOrEqual(100);
    });

    it("排除超出预算的文档", () => {
      const bigDoc = {
        pageContent: "A".repeat(10000),
        metadata: { source: "big.md", domain: "test" },
      } as KnowledgeDocument;
      const smallDoc = { pageContent: "小文档", metadata: { source: "small.md", domain: "test" } } as KnowledgeDocument;
      const result = trimDocsToBudget([bigDoc, smallDoc], 20, 1500);
      expect(result.excluded).toBeGreaterThanOrEqual(1);
    });
  });
});

// ── citation 测试 ──
describe("rag/citation", () => {
  describe("buildCitedContext", () => {
    it("生成带引用标记的上下文", () => {
      const docs: KnowledgeDocument[] = [
        { pageContent: "内容1", metadata: { source: "a.md", domain: "中医", h1: "标题1" } },
        { pageContent: "内容2", metadata: { source: "b.md", domain: "命理" } },
      ];
      const result = buildCitedContext(docs);
      expect(result.context).toContain("[ref-1]");
      expect(result.context).toContain("[ref-2]");
      expect(result.entries).toHaveLength(2);
    });
  });

  describe("parseCitations", () => {
    it("解析引用标记", () => {
      const entries: import("../rag/citation.js").CitationEntry[] = [
        { refIndex: 1, source: "a.md", title: "", domain: "" },
        { refIndex: 2, source: "b.md", title: "", domain: "" },
      ];
      const result = parseCitations("这是文本[ref-1]和[ref-2]", entries);
      expect(result.citedRefs).toEqual([1, 2]);
      expect(result.cleanText).toBe("这是文本和");
    });

    it("无引用时返回空数组", () => {
      const entries: import("../rag/citation.js").CitationEntry[] = [
        { refIndex: 1, source: "a.md", title: "", domain: "" },
      ];
      const result = parseCitations("没有引用的文本", entries);
      expect(result.citedRefs).toEqual([]);
    });
  });

  describe("formatCitations", () => {
    it("格式化引用脚注", () => {
      const entries: import("../rag/citation.js").CitationEntry[] = [
        { refIndex: 1, source: "a.md", title: "标题A", domain: "中医" },
      ];
      const result = formatCitations([1], entries);
      expect(result).toContain("[ref-1]");
      expect(result).toContain("a.md");
    });

    it("无引用时返回空字符串", () => {
      const result = formatCitations([], []);
      expect(result).toBe("");
    });
  });
});
