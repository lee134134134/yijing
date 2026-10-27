/**
 * Token-aware context window management
 *
 * Phase 3: 上下文安全
 * - Estimate token counts for Chinese text
 * - Truncate document set to fit within max context window
 * - Reserve token budget for prompt template + generation
 */

import { config } from "../config.js";
import { createLogger } from "../logger.js";
import type { KnowledgeDocument } from "../types.js";

const log = createLogger("rag:context-manager");

/**
 * Rough token estimation for mixed Chinese/English text
 *
 * Chinese characters: ~1 token per 1.5 chars
 * English words: ~1 token per 0.75 words
 * This is a safe overestimate to prevent truncation mid-generation.
 */
export function estimateTokens(text: string): number {
  let tokens = 0;
  for (const char of text) {
    if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(char)) {
      tokens += 1; // CJK: roughly 1 token per char
    } else if (/[\u3000-\u303f\uff00-\uffef]/.test(char)) {
      tokens += 1; // CJK punctuation
    } else if (/\s/.test(char)) {
    } else {
      tokens += 0.35; // Latin characters
    }
  }
  return Math.ceil(tokens);
}

/**
 * Calculate total context budget
 *
 * Budget = maxContextTokens - promptOverhead - generationBudget
 * - promptOverhead: system prompt + template + user input
 * - generationBudget: tokens reserved for LLM response
 */
export function getContextBudget(promptOverhead: number = 2000, generationBudget: number = 4096): number {
  const total = config.maxContextTokens;
  const budget = total - promptOverhead - generationBudget;
  return Math.max(budget, 512);
}

export interface TrimResult {
  docs: KnowledgeDocument[];
  totalTokens: number;
  excluded: number;
}

/**
 * Trim documents to fit within context budget
 *
 * Documents are processed in order of the input array (pre-sorted by relevance).
 * Keeps the most relevant documents and discards excess based on token count.
 * Each doc is truncated to maxDocTokens if it exceeds the limit.
 */
export function trimDocsToBudget(docs: KnowledgeDocument[], budget: number, maxDocTokens: number = 1500): TrimResult {
  let totalTokens = 0;
  const kept: KnowledgeDocument[] = [];

  for (const doc of docs) {
    const tokens = estimateTokens(doc.pageContent);

    if (totalTokens + Math.min(tokens, maxDocTokens) > budget) {
      log.debug(
        { doc: doc.metadata.source, tokens, budgetRemaining: budget - totalTokens },
        "Doc exceeded budget, excluded",
      );
      continue;
    }

    if (tokens > maxDocTokens) {
      const truncated = truncateToTokens(doc, maxDocTokens);
      kept.push(truncated);
      totalTokens += maxDocTokens;
    } else {
      kept.push(doc);
      totalTokens += tokens;
    }
  }

  return {
    docs: kept,
    totalTokens,
    excluded: docs.length - kept.length,
  };
}

function truncateToTokens(doc: KnowledgeDocument, maxTokens: number): KnowledgeDocument {
  const chars = [...doc.pageContent];
  let tokenCount = 0;
  let cutoff = chars.length;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(ch)) {
      tokenCount += 1;
    } else if (!/\s/.test(ch)) {
      tokenCount += 0.35;
    }
    if (tokenCount > maxTokens) {
      cutoff = i;
      break;
    }
  }

  return {
    ...doc,
    pageContent: `${doc.pageContent.slice(0, cutoff)}\n[...truncated]`,
  } as KnowledgeDocument;
}

/**
 * Full context preparation pipeline
 *
 * 1. Estimate total tokens across all docs
 * 2. If over budget, trim to fit
 * 3. Return context string + metadata
 */
export function prepareContext(
  docs: KnowledgeDocument[],
  promptOverhead?: number,
  generationBudget?: number,
): {
  context: string;
  docCount: number;
  totalTokens: number;
  excluded: number;
} {
  const budget = getContextBudget(promptOverhead, generationBudget);
  const trimmed = trimDocsToBudget(docs, budget);

  const context = trimmed.docs
    .map(
      (doc, i) =>
        `【参考 ${i + 1}】来源: ${doc.metadata.source} 章节: ${[doc.metadata.h1, doc.metadata.h2, doc.metadata.h3].filter(Boolean).join(" > ")} 领域: ${doc.metadata.domain}\n\n${doc.pageContent}`,
    )
    .join("\n\n---\n\n");

  return {
    context,
    docCount: trimmed.docs.length,
    totalTokens: trimmed.totalTokens,
    excluded: trimmed.excluded,
  };
}
