import { describe, expect, it } from "vitest";

// Inline functions matching src/vectorstore/chroma.ts logic
// to avoid importing modules that trigger LangChain/fs side effects
function getChars(text: string): string[] {
  return [...text];
}

function charNgrams(text: string, n: number): Set<string> {
  const chars = getChars(text);
  const ngrams = new Set<string>();
  for (let i = 0; i <= chars.length - n; i++) {
    ngrams.add(chars.slice(i, i + n).join(""));
  }
  return ngrams;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function computeQuerySignature(query: string) {
  return {
    bigrams: charNgrams(query, 2),
    trigrams: charNgrams(query, 3),
    chars: new Set(getChars(query)),
  };
}

function computeDocSignature(content: string) {
  const chars = getChars(content);
  const terms = new Set<string>();
  for (let i = 0; i < chars.length; i++) {
    for (let len = 2; len <= 4 && i + len <= chars.length; len++) {
      terms.add(chars.slice(i, i + len).join(""));
    }
  }
  return {
    bigrams: charNgrams(content, 2),
    trigrams: charNgrams(content, 3),
    chars: new Set(getChars(content)),
    keyTerms: terms,
  };
}

function scoreRelevance(
  query: string,
  content: string,
  metadata: { h1?: string; h2?: string; domain?: string },
): number {
  const qSig = computeQuerySignature(query);
  const dSig = computeDocSignature(content);

  const bigramScore = jaccardSimilarity(qSig.bigrams, dSig.bigrams);
  const trigramScore = jaccardSimilarity(qSig.trigrams, dSig.trigrams);
  const charScore = jaccardSimilarity(qSig.chars, dSig.chars);

  const titleBonus =
    metadata.h2 && query.includes(metadata.h2) ? 0.15 : metadata.h1 && query.includes(metadata.h1) ? 0.1 : 0;

  const domainBonus = metadata.domain && query.includes(metadata.domain) ? 0.1 : 0;

  return bigramScore * 0.35 + trigramScore * 0.35 + charScore * 0.3 + titleBonus + domainBonus;
}

interface Doc {
  id: string;
  score: number;
}

function rrfFuse(vectorResults: Doc[], keywordResults: Doc[], topK: number, k = 60): Doc[] {
  const combined = new Map<string, Doc>();

  vectorResults.forEach((entry, i) => {
    combined.set(entry.id, { id: entry.id, score: 1 / (k + i) });
  });

  keywordResults.forEach((entry, i) => {
    const existing = combined.get(entry.id);
    if (existing) {
      existing.score += 1 / (k + i);
    } else {
      combined.set(entry.id, { id: entry.id, score: 1 / (k + i) });
    }
  });

  return Array.from(combined.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// ========================================
// Tests
// ========================================

describe("charNgrams", () => {
  it("generates correct n-grams for Chinese text", () => {
    const bigrams = charNgrams("中医", 2);
    expect(bigrams.has("中医")).toBe(true);
    expect(bigrams.size).toBe(1);

    const trigrams = charNgrams("伤寒论", 3);
    expect(trigrams.has("伤寒论")).toBe(true);
    expect(trigrams.size).toBe(1);
  });

  it("returns empty set for text shorter than n", () => {
    expect(charNgrams("ab", 3).size).toBe(0);
  });

  it("handles empty string", () => {
    expect(charNgrams("", 2).size).toBe(0);
  });

  it("generates sliding n-grams", () => {
    const result = charNgrams("abcde", 2);
    expect(result.has("ab")).toBe(true);
    expect(result.has("bc")).toBe(true);
    expect(result.has("cd")).toBe(true);
    expect(result.has("de")).toBe(true);
    expect(result.size).toBe(4);
  });
});

describe("jaccardSimilarity", () => {
  it("returns 1 for identical sets", () => {
    const a = new Set(["a", "b", "c"]);
    expect(jaccardSimilarity(a, a)).toBe(1);
  });

  it("returns 0 for disjoint sets", () => {
    const a = new Set(["a", "b"]);
    const b = new Set(["c", "d"]);
    expect(jaccardSimilarity(a, b)).toBe(0);
  });

  it("returns correct value for partial overlap", () => {
    const a = new Set(["a", "b", "c"]);
    const b = new Set(["b", "c", "d"]);
    // intersection = {b,c} = 2, union = {a,b,c,d} = 4, score = 0.5
    expect(jaccardSimilarity(a, b)).toBeCloseTo(0.5);
  });

  it("handles empty sets", () => {
    expect(jaccardSimilarity(new Set(), new Set(["a"]))).toBe(0);
    expect(jaccardSimilarity(new Set(), new Set())).toBe(0);
  });
});

describe("computeQuerySignature", () => {
  it("returns bigrams, trigrams, and chars for a query", () => {
    const sig = computeQuerySignature("桂枝汤");
    expect(sig.bigrams.size).toBeGreaterThan(0);
    expect(sig.trigrams.size).toBeGreaterThan(0);
    expect(sig.chars.size).toBe(3);
  });
});

describe("computeDocSignature", () => {
  it("includes keyTerms of length 2-4", () => {
    const sig = computeDocSignature("abcd");
    // 2-grams: ab, bc, cd (3)
    // 3-grams: abc, bcd (2)
    // 4-grams: abcd (1)
    expect(sig.keyTerms.size).toBe(6);
  });
});

describe("scoreRelevance", () => {
  it("scores exact match higher than partial match", () => {
    const content = "桂枝汤由桂枝、芍药、甘草、生姜、大枣组成";
    const exact = scoreRelevance("桂枝汤", content, {});
    const partial = scoreRelevance("感冒", content, {});
    expect(exact).toBeGreaterThan(partial);
  });

  it("applies title bonus when query matches h2", () => {
    const content = "桂枝汤是伤寒论第一方";
    const withBonus = scoreRelevance("桂枝汤", content, { h2: "桂枝汤" });
    const noBonus = scoreRelevance("桂枝汤", content, {});
    expect(withBonus).toBeGreaterThan(noBonus);
  });

  it("applies domain bonus when query matches domain", () => {
    const content = "方剂知识";
    const withBonus = scoreRelevance("方剂", content, { domain: "方剂" });
    const noBonus = scoreRelevance("方剂", content, {});
    expect(withBonus).toBeGreaterThan(noBonus);
  });
});

describe("rrfFuse", () => {
  const docs: Doc[] = [
    { id: "a", score: 0 },
    { id: "b", score: 0 },
    { id: "c", score: 0 },
    { id: "d", score: 0 },
  ];

  it("combines and reranks results from two sources", () => {
    const vec = [docs[0], docs[1], docs[2]]; // a, b, c
    const kw = [docs[1], docs[2], docs[3]]; // b, c, d
    const fused = rrfFuse(vec, kw, 3, 60);

    expect(fused).toHaveLength(3);
    // b and c appear in both lists → higher score
    expect(fused[0].id).toBe("b");
    expect(fused[1].id).toBe("c");
  });

  it("respects topK limit", () => {
    const vec = [docs[0], docs[1], docs[2], docs[3]];
    const kw: Doc[] = [];
    expect(rrfFuse(vec, kw, 2, 60)).toHaveLength(2);
  });

  it("returns empty for empty inputs", () => {
    expect(rrfFuse([], [], 5, 60)).toHaveLength(0);
  });
});
