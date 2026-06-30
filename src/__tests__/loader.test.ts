import { Document } from "@langchain/core/documents";
import { describe, expect, it } from "vitest";
import { extractSections, inferDomain } from "../ingestion/loader.js";
import type { KnowledgeDocument } from "../types.js";

// ========================================
// inferDomain
// ========================================

describe("inferDomain", () => {
  const cases: [string, string][] = [
    ["shanghanlun.md", "伤寒论"],
    ["jinguiyaolue.md", "金匮要略"],
    ["huangdi_neijing.md", "黄帝内经"],
    ["shennongbencao.md", "神农本草经"],
    ["zhenjiu.md", "针灸"],
    ["tianjdao.md", "天纪"],
    ["mingli_bazi.md", "命理八字"],
    ["mianxiang.md", "面相学"],
    ["zhongyi_xin.md", "中医临床"],
    ["yangsheng.md", "养生功法"],
    ["fangji.md", "方剂"],
    ["yian.md", "医案"],
    ["yinshi.md", "阴实理论"],
    ["wenji.md", "文集"],
    ["jiapu.md", "家谱"],
  ];

  it.each(cases)("maps %s to %s", (filename, expected) => {
    expect(inferDomain(filename)).toBe(expected);
  });

  it("returns 综合 for unknown files", () => {
    expect(inferDomain("unknown_file.md")).toBe("综合");
    expect(inferDomain("README.md")).toBe("综合");
  });

  it("is case-insensitive for filename (not extension)", () => {
    expect(inferDomain("Shanghanlun.md")).toBe("伤寒论");
  });
});

// ========================================
// extractSections
// ========================================

function makeDoc(content: string, source = "test.md", domain = "综合"): KnowledgeDocument {
  return new Document({ pageContent: content, metadata: { source, domain } });
}

describe("extractSections", () => {
  it("splits by h2 headings", () => {
    const doc = makeDoc(`# 伤寒论

## 太阳病篇

太阳之为病，脉浮，头项强痛而恶寒。

## 阳明病篇

阳明之为病，胃家实是也。`);
    const sections = extractSections(doc);
    expect(sections).toHaveLength(2);
    expect(sections[0].metadata.h2).toBe("太阳病篇");
    expect(sections[1].metadata.h2).toBe("阳明病篇");
  });

  it("tracks h1 from first heading", () => {
    const doc = makeDoc("# 伤寒论\n\n## 太阳病\n\n内容。");
    const sections = extractSections(doc);
    expect(sections[0].metadata.h1).toBe("伤寒论");
  });

  it("splits by h3 when current section is long enough", () => {
    const doc = makeDoc(`# 本草\n\n## 上经\n\n${"药".repeat(300)}\n\n### 人参\n\n内容。\n\n### 甘草\n\n内容。`);
    const sections = extractSections(doc);
    // The long paragraph under ## 上经 gets flushed at h3 boundary,
    // then each h3 becomes its own section
    expect(sections.length).toBeGreaterThanOrEqual(2);
  });

  it("filters empty/short sections under 10 chars", () => {
    const doc = makeDoc("# 标题\n\n## 空段\n\n");

    const sections = extractSections(doc);
    expect(sections).toHaveLength(0);
  });

  it("preserves metadata from parent doc", () => {
    const doc = makeDoc("## 方剂\n\n内容。", "test.md", "方剂");
    const sections = extractSections(doc);
    expect(sections[0].metadata.source).toBe("test.md");
    expect(sections[0].metadata.domain).toBe("方剂");
  });

  it("tracks lineRange correctly", () => {
    const content = "# 标题\n\n## 第一节\n\n内容行1\n\n内容行2\n\n## 第二节\n\n其他内容";
    const doc = makeDoc(content);
    const sections = extractSections(doc);
    expect(sections[0].metadata.lineRange).toBeDefined();
    // First section starts at line 3 (## 第一节 is line 3) and goes until before ## 第二节
  });

  it("creates a single section from content with no headings when sufficiently long", () => {
    const doc = makeDoc("纯文本内容，没有任何标题标记。\n\n第二行。");
    const sections = extractSections(doc);
    // Content length >= 10, so it becomes 1 section
    expect(sections).toHaveLength(1);
    expect(sections[0].pageContent).toContain("纯文本内容");
  });
});
