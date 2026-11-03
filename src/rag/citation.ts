/**
 * 引用(citation)数据模型
 *
 * 设计要点:
 * - refId 由 source + 标题 + 内容哈希生成,跨多次工具调用保持稳定
 * - 工具输出 [ref:<id>],模型在回答中引用同一个 id
 * - API 返回结构化 citations[],前端可据此定位原文;不再依赖正则数 【来源】
 *
 * 旧实现用 [ref-1] 且每次工具调用重新编号,同一编号在不同调用中指向不同文档,
 * 无法校验也无法回溯,已移除。
 */

import { createHash } from "node:crypto";
import type { Citation, KnowledgeDocument, RetrievedDocument } from "../types.js";

/** 生成稳定引用 id(8 位 sha1) */
export function makeRefId(doc: KnowledgeDocument): string {
  const { source, h1, h2, h3 } = doc.metadata;
  const raw = [source, h1 ?? "", h2 ?? "", h3 ?? "", doc.pageContent].join("\u0000");
  return createHash("sha1").update(raw).digest("hex").slice(0, 8);
}

/** 文档 → 引用条目 */
export function buildCitation(doc: RetrievedDocument): Citation {
  const { source, h1, h2, h3, lineRange, domain, book, chapter, sectionPath, pageStart, pageEnd, layer } = doc.metadata;
  return {
    refId: makeRefId(doc),
    source,
    ...(h1 ? { h1 } : {}),
    ...(h2 ? { h2 } : {}),
    ...(h3 ? { h3 } : {}),
    ...(lineRange ? { lineRange } : {}),
    domain,
    snippet: doc.pageContent.slice(0, 300),
    ...(doc.score !== undefined ? { score: doc.score } : {}),
    ...(book ? { book } : {}),
    ...(chapter ? { chapter } : {}),
    ...(sectionPath ? { sectionPath } : {}),
    ...(pageStart !== undefined ? { pageStart } : {}),
    ...(pageEnd !== undefined ? { pageEnd } : {}),
    ...(layer ? { layer } : {}),
  };
}

/**
 * 生成带引用标记的上下文(供非 Agent 管线使用)
 *
 * 每个文档一条 [ref:<id>],与 citations 一一对应。
 */
export function buildCitedContext(docs: RetrievedDocument[]): {
  context: string;
  citations: Citation[];
} {
  const citations = docs.map(buildCitation);
  const context = docs
    .map((doc, i) => {
      const citation = citations[i]!;
      const section = [citation.h1, citation.h2, citation.h3].filter(Boolean).join(" > ");
      return `[ref:${citation.refId}] 来源: ${citation.source}${section ? ` 章节: ${section}` : ""} 领域: ${citation.domain}\n\n${doc.pageContent}`;
    })
    .join("\n\n---\n\n");

  return { context, citations };
}

/**
 * 从回答文本中提取引用 id
 *
 * 允许任意字符(便于识别模型编造的 id),由调用方与本次检索集合比对。
 */
export function parseCitedRefIds(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(/\[ref:([^\]\s]+)\]/g)) {
    if (match[1]) ids.add(match[1]);
  }
  return [...ids];
}

/**
 * 校验引用:返回命中的引用与未命中的 id
 *
 * 未命中 = 模型编造或引用了本次未检索到的文档。
 */
export function validateCitations(
  citedIds: string[],
  citations: Citation[],
): { valid: Citation[]; invalidRefIds: string[] } {
  const byId = new Map(citations.map((c) => [c.refId, c]));
  const valid: Citation[] = [];
  const invalidRefIds: string[] = [];

  for (const id of citedIds) {
    const citation = byId.get(id);
    if (citation) valid.push(citation);
    else invalidRefIds.push(id);
  }

  return { valid, invalidRefIds };
}

/** 格式化引用脚注(供需要纯文本输出的场景) */
export function formatCitationFootnote(citations: Citation[]): string {
  if (citations.length === 0) return "";
  const lines = citations.map((c) => {
    const section = [c.h1, c.h2, c.h3].filter(Boolean).join(" > ");
    return `  [ref:${c.refId}] ${c.source}${section ? ` — ${section}` : ""}`;
  });
  return `\n\n---\n📚 参考来源:\n${lines.join("\n")}`;
}

/**
 * 从工具输出中解析引用锚点(兜底)
 *
 * 正常情况下工具会写入 CitationCollector;这里再解析一遍文本,
 * 防止 AsyncLocalStorage 上下文在某些执行器实现中丢失导致引用为空。
 * 格式由 tools.ts 固定:
 *   [ref:abcd1234] 【来源】source > h2 | domain | 相关度 0.83
 *   <content>
 */
export function parseToolCitations(text: string): Citation[] {
  const citations: Citation[] = [];
  for (const block of text.split(/\n\n---\n\n/)) {
    const [header, ...rest] = block.split("\n");
    const match = header?.match(/^\[ref:([a-f0-9]{8})\]\s*【来源】(.+)$/);
    if (!match) continue;

    const refId = match[1]!;
    const parts = match[2]!.split("|").map((part) => part.trim());
    const left = parts[0] ?? "";
    const [source, h2] = left.split(">").map((part) => part.trim());
    if (!source) continue;

    citations.push({
      refId,
      source,
      ...(h2 ? { h2 } : {}),
      domain: parts[1] ?? "",
      snippet: rest.join("\n").trim().slice(0, 300),
    });
  }
  return citations;
}

/** 合并多组引用(按 refId 去重,先到先得) */
export function mergeCitations(...groups: Citation[][]): Citation[] {
  const merged = new Map<string, Citation>();
  for (const group of groups) {
    for (const citation of group) {
      if (!merged.has(citation.refId)) merged.set(citation.refId, citation);
    }
  }
  return [...merged.values()];
}
