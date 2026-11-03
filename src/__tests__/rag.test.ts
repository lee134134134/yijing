/**
 * RAG 模块单元测试
 *
 * 测试 citation 模块的核心逻辑;上下文压缩由 deepagents summarization 中间件负责。
 */

import { describe, expect, it } from "vitest";
import {
  buildCitation,
  buildCitedContext,
  formatCitationFootnote,
  makeRefId,
  mergeCitations,
  parseCitedRefIds,
  parseToolCitations,
  validateCitations,
} from "../rag/citation.js";
import type { KnowledgeDocument } from "../types.js";

// ── citation 测试 ──
describe("rag/citation", () => {
  const docs: KnowledgeDocument[] = [
    { pageContent: "内容1", metadata: { source: "a.md", domain: "中医", h1: "标题1" } },
    { pageContent: "内容2", metadata: { source: "b.md", domain: "命理" } },
  ];

  it("refId 稳定且不同文档不同", () => {
    expect(makeRefId(docs[0]!)).toBe(makeRefId(docs[0]!));
    expect(makeRefId(docs[0]!)).not.toBe(makeRefId(docs[1]!));
    expect(makeRefId(docs[0]!)).toMatch(/^[a-f0-9]{8}$/);
  });

  describe("buildCitation", () => {
    it("带元数据与 snippet", () => {
      const citation = buildCitation(docs[0]!);
      expect(citation.source).toBe("a.md");
      expect(citation.h1).toBe("标题1");
      expect(citation.domain).toBe("中医");
      expect(citation.snippet).toContain("内容1");
    });
  });

  describe("buildCitedContext", () => {
    it("使用 [ref:<id>] 标记并返回 citations", () => {
      const result = buildCitedContext(docs);
      expect(result.context).toContain(`[ref:${makeRefId(docs[0]!)}]`);
      expect(result.context).toContain(`[ref:${makeRefId(docs[1]!)}]`);
      expect(result.citations).toHaveLength(2);
    });
  });

  describe("parseCitedRefIds", () => {
    it("提取唯一 id", () => {
      expect(parseCitedRefIds("a[ref:abcd1234] b[ref:abcd1234] c[ref:deadbeef]")).toEqual(["abcd1234", "deadbeef"]);
    });

    it("无引用时返回空数组", () => {
      expect(parseCitedRefIds("没有引用的文本")).toEqual([]);
    });
  });

  describe("validateCitations", () => {
    it("区分命中与编造", () => {
      const citations = docs.map((doc) => buildCitation(doc));
      const result = validateCitations(["abcd1234", citations[0]!.refId], citations);
      expect(result.valid).toHaveLength(1);
      expect(result.invalidRefIds).toEqual(["abcd1234"]);
    });
  });

  describe("formatCitationFootnote", () => {
    it("无引用时返回空字符串", () => {
      expect(formatCitationFootnote([])).toBe("");
    });

    it("有引用时包含来源", () => {
      const text = formatCitationFootnote([buildCitation(docs[0]!)]);
      expect(text).toContain("a.md");
      expect(text).toContain("[ref:");
    });
  });

  describe("parseToolCitations", () => {
    it("从工具输出解析稳定引用与片段", () => {
      const text = [
        "[ref:abcd1234] 【来源】shanghanlun.md > 桂枝汤 | 伤寒论 | 相关度 0.72",
        "桂枝汤方：桂枝三两。",
        "",
        "---",
        "",
        "[ref:deadbeef] 【来源】zhenjiu.md | 针灸",
        "足三里定位。",
      ].join("\n");

      const citations = parseToolCitations(text);
      expect(citations).toHaveLength(2);
      expect(citations[0]).toMatchObject({
        refId: "abcd1234",
        source: "shanghanlun.md",
        h2: "桂枝汤",
        domain: "伤寒论",
      });
      expect(citations[0]?.snippet).toContain("桂枝汤方");
      expect(citations[1]?.domain).toBe("针灸");
    });
  });

  describe("mergeCitations", () => {
    it("按 refId 去重且保留先到条目", () => {
      const a = buildCitation(docs[0]!);
      const merged = mergeCitations([a], [a, buildCitation(docs[1]!)]);
      expect(merged).toHaveLength(2);
      expect(merged[0]?.source).toBe("a.md");
    });
  });
});
