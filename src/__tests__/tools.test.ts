/**
 * Unit tests for the DeepAgent tool layer (tools.ts)
 *
 * Verifies search_knowledge_base / search_by_domain output format:
 * 【来源】 source anchor line, truncation, and empty-result messaging.
 */
import { describe, expect, it, vi } from "vitest";
import { searchByDomainTool, searchKnowledgeBaseTool } from "../agents/tools.js";

vi.mock("../vectorstore/chroma.js", () => ({
  searchKnowledge: vi.fn(),
  searchByDomain: vi.fn(),
}));

vi.mock("../config.js", () => ({
  config: {
    retrievalTopK: 5,
    llmModel: "gpt-4o-mini",
  },
}));

import { searchByDomain, searchKnowledge } from "../vectorstore/chroma.js";

const mkDoc = (over: Partial<{ pageContent: string; source: string; h2: string; domain: string }> = {}) => ({
  pageContent: over.pageContent ?? "桂枝汤方：桂枝三两，芍药三两，甘草二两，生姜三两，大枣十二枚。",
  metadata: {
    source: over.source ?? "shanghanlun.md",
    h2: over.h2 ?? "桂枝汤",
    domain: over.domain ?? "伤寒论",
  },
});

describe("search_knowledge_base", () => {
  it("is named search_knowledge_base with zod schema", () => {
    expect(searchKnowledgeBaseTool.name).toBe("search_knowledge_base");
    expect(searchKnowledgeBaseTool.schema).toBeDefined();
  });

  it("formats output with 【来源】 anchor lines", async () => {
    vi.mocked(searchKnowledge).mockResolvedValue([
      mkDoc(),
      mkDoc({ source: "zhongyi_xin.md", h2: "不寐", domain: "中医临床" }),
    ]);

    const output = await searchKnowledgeBaseTool.invoke({ query: "失眠" });

    expect(output).toContain("【来源】shanghanlun.md > 桂枝汤 | 伤寒论");
    expect(output).toContain("【来源】zhongyi_xin.md > 不寐 | 中医临床");
    expect(output).toContain("[1] ");
    expect(output).toContain("[2] ");
    expect(output).toContain("桂枝汤方：桂枝三两");
  });

  it("truncates long documents to 800 chars", async () => {
    vi.mocked(searchKnowledge).mockResolvedValue([mkDoc({ pageContent: "长".repeat(2000) })]);

    const output = await searchKnowledgeBaseTool.invoke({ query: "长文" });

    expect(output.length).toBeLessThan(850);
    expect(output).not.toContain("长".repeat(1200));
  });

  it("returns no-result message when empty", async () => {
    vi.mocked(searchKnowledge).mockResolvedValue([]);

    const output = await searchKnowledgeBaseTool.invoke({ query: "汽车风水" });

    expect(output).toBe("未找到相关知识。");
  });

  it("passes topK through to searchKnowledge", async () => {
    vi.mocked(searchKnowledge).mockResolvedValue([mkDoc()]);

    await searchKnowledgeBaseTool.invoke({ query: "失眠", topK: 3 });

    expect(searchKnowledge).toHaveBeenCalledWith("失眠", 3);
  });
});

describe("search_by_domain", () => {
  it("is named search_by_domain", () => {
    expect(searchByDomainTool.name).toBe("search_by_domain");
  });

  it("formats output with source anchor and domain", async () => {
    vi.mocked(searchByDomain).mockResolvedValue([mkDoc({ domain: "伤寒论" })]);

    const output = await searchByDomainTool.invoke({ domain: "伤寒论", query: "汗法" });

    expect(output).toContain("【来源】shanghanlun.md > 桂枝汤 | 伤寒论");
  });

  it("returns domain-specific message when empty", async () => {
    vi.mocked(searchByDomain).mockResolvedValue([]);

    const output = await searchByDomainTool.invoke({ domain: "命理八字", query: "正官格" });

    expect(output).toContain("领域");
    expect(output).toContain("命理八字");
    expect(output).toContain("未找到");
  });

  it("rejects domains outside the enum", async () => {
    // @ts-expect-error 领域必须是枚举值
    await expect(searchByDomainTool.invoke({ domain: "不存在的领域", query: "x" })).rejects.toThrow();
  });
});
