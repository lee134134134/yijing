/**
 * Structured citation tracking for RAG output
 *
 * Phase 3: 引用追踪
 * - Assign reference IDs to retrieved documents
 * - Format context with citation markers
 * - Parse response for cited references
 */

import type { KnowledgeDocument } from "../types.js";

export interface CitationEntry {
  refIndex: number;
  source: string;
  title: string;
  domain: string;
}

export interface CitationResult {
  /** The context formatted with reference markers, ready for LLM prompt */
  context: string;
  /** Entries that were included in context */
  entries: CitationEntry[];
}

/**
 * Format retrieved documents with citation markers and return the mapping
 *
 * Each document gets a [ref-N] marker. The context string includes these
 * markers so the LLM can reference them naturally.
 */
export function buildCitedContext(docs: KnowledgeDocument[]): CitationResult {
  const entries: CitationEntry[] = docs.map((doc, i) => ({
    refIndex: i + 1,
    source: doc.metadata.source,
    title: [doc.metadata.h1, doc.metadata.h2, doc.metadata.h3].filter(Boolean).join(" > "),
    domain: doc.metadata.domain,
  }));

  const context = docs
    .map(
      (doc, i) =>
        `[ref-${i + 1}] 来源: ${doc.metadata.source} 章节: ${[doc.metadata.h1, doc.metadata.h2, doc.metadata.h3].filter(Boolean).join(" > ")} 领域: ${doc.metadata.domain}\n\n${doc.pageContent}`,
    )
    .join("\n\n---\n\n");

  return { context, entries };
}

/**
 * Parse citations from LLM response text
 *
 * Scans for patterns like [ref-1], [ref-2, ref-3], [来源: xxx], [1][2]
 * and returns the matched ref indices along with the clean text.
 */
export function parseCitations(response: string, entries: CitationEntry[]): { cleanText: string; citedRefs: number[] } {
  const refPattern = /\[ref-(\d+)\]/g;
  const citedSet = new Set<number>();

  for (const m of response.matchAll(refPattern)) {
    const idx = parseInt(m[1]!, 10);
    if (idx >= 1 && idx <= entries.length) {
      citedSet.add(idx);
    }
  }

  const cleanText = response
    .replace(/\[ref-\d+\]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return {
    cleanText,
    citedRefs: Array.from(citedSet).sort((a, b) => a - b),
  };
}

/**
 * Format citations as a footnote string (appended to response if wanted)
 */
export function formatCitations(citedRefs: number[], entries: CitationEntry[]): string {
  if (citedRefs.length === 0) return "";

  const lines = citedRefs.map((refIdx) => {
    const entry = entries[refIdx - 1];
    if (!entry) return `[ref-${refIdx}] `;
    return `[ref-${refIdx}] ${entry.source}${entry.title ? ` — ${entry.title}` : ""}`;
  });

  return `\n\n---\n📚 参考来源:\n${lines.map((l) => `  ${l}`).join("\n")}`;
}
