/**
 * Integration tests for agenticRag and deepAnalysis pipelines
 *
 * Mocks LLM, ChromaDB, and all internal modules so tests run
 * without external dependencies.
 */
import { describe, expect, it, vi } from "vitest";

// ── Mocks (hoisted by vitest) ────────────────────────────────────

vi.mock("../config.js", () => ({
  config: {
    enableQueryRewrite: true,
    rewriteNumQueries: 3,
    retrievalTopK: 5,
    llmModel: "gpt-4o-mini",
    llmTemperature: 0.3,
    openaiBaseUrl: "http://localhost:8000",
    openaiApiKey: "test-key",
    llmMaxRetries: 2,
    llmRetryBaseDelay: 10,
    maxHistory: 200,
    maxContextTokens: 8192,
    enableReranking: false,
    embeddingModel: "text-embedding-3-small",
    embeddingDimension: 1536,
    chromaDbUrl: "http://localhost:8000",
    chromaCollectionName: "test",
    knowledgeDir: "/tmp/test",
    dataDir: "/tmp/test",
    chunkSize: 800,
    chunkOverlap: 150,
    sqlitePath: "/tmp/test/test.db",
    apiPort: 3001,
    apiHost: "0.0.0.0",
    corsOrigin: "http://localhost:5173",
    logLevel: "silent",
    logFile: false,
  },
}));

vi.mock("../rag/chain.js", () => ({
  classifyQuery: vi.fn().mockResolvedValue("tcm_diagnosis"),
  getChatModel: vi.fn(),
}));

vi.mock("../rag/query-rewriting.js", () => ({
  rewriteQuery: vi.fn().mockResolvedValue({
    primary: "失眠中医辨证治疗",
    alternatives: ["多梦易醒中医调理方法", "不寐证针灸取穴"],
    all: ["失眠中医辨证治疗", "多梦易醒中医调理方法", "不寐证针灸取穴"],
  }),
  cleanQuery: vi.fn((q: string) => q),
}));

vi.mock("../vectorstore/chroma.js", () => ({
  multiQuerySearch: vi.fn().mockResolvedValue([
    {
      pageContent: "失眠多梦，心脾两虚，治宜补益心脾，方用归脾汤。",
      metadata: { source: "zhongyi_xin.md", domain: "中医临床", h1: "内科", h2: "不寐" },
    },
    {
      pageContent: "桂枝汤方：桂枝三两，芍药三两，甘草二两，生姜三两，大枣十二枚。",
      metadata: { source: "shanghanlun.md", domain: "伤寒论", h1: "太阳病篇", h2: "桂枝汤" },
    },
    {
      pageContent: "八段锦功法：双手托天理三焦，左右开弓似射雕...",
      metadata: { source: "yangsheng.md", domain: "养生功法", h1: "八段锦" },
    },
  ]),
  searchKnowledge: vi.fn().mockResolvedValue([
    {
      pageContent: "失眠多梦，心脾两虚，治宜补益心脾。",
      metadata: { source: "zhongyi_xin.md", domain: "中医临床" },
    },
  ]),
}));

vi.mock("../rag/context-manager.js", () => ({
  prepareContext: vi.fn().mockReturnValue({
    context: "模拟上下文内容…",
    docCount: 3,
    totalTokens: 450,
    excluded: 0,
  }),
}));

vi.mock("../rag/citation.js", () => ({
  buildCitedContext: vi.fn().mockReturnValue({
    context: "模拟引用上下文…",
    entries: [
      { refIndex: 1, source: "zhongyi_xin.md", title: "内科 > 不寐", domain: "中医临床" },
    ],
  }),
  parseCitations: vi.fn().mockReturnValue({ cleanText: "模拟回答", citedRefs: [] }),
  formatCitations: vi.fn().mockReturnValue(""),
}));

vi.mock("../logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
  createRequestContext: vi.fn(() => ({ requestId: "test-123" })),
  logRequestComplete: vi.fn(),
}));

// ── Mock LangChain at the chain level ───────────────────────────
const _chainInvoke = vi.fn().mockResolvedValue(
  "模拟 AI 回答：失眠多梦属于心脾两虚证，可参考归脾汤加减。",
);
const _chainStream = vi.fn().mockImplementation(async function* () {
  yield "模拟 AI 回答：";
  yield "失眠多梦属于心脾两虚证，";
  yield "可参考归脾汤加减。";
});

vi.mock("@langchain/core/prompts", () => ({
  PromptTemplate: {
    fromTemplate: vi.fn(() => ({
      pipe: vi.fn(() => ({
        pipe: vi.fn(() => ({
          invoke: _chainInvoke,
          stream: _chainStream,
        })),
      })),
    })),
  },
}));

vi.mock("@langchain/core/output_parsers", () => ({
  StringOutputParser: vi.fn(function () {
    /* mock */
  }),
}));

vi.mock("@langchain/openai", () => ({
  ChatOpenAI: vi.fn(function (this: any) {
    this.pipe = vi.fn().mockReturnThis();
    this.invoke = vi.fn().mockResolvedValue({ content: "mock" });
    this.stream = vi.fn();
  }),
}));

// ── SUT ──────────────────────────────────────────────────────────
import { agenticRag, deepAnalysis } from "../agents/index.js";

// ================================================================
// agenticRag
// ================================================================
describe("agenticRag", () => {
  it("returns response, queryType and docCount", async () => {
    const result = await agenticRag("失眠怎么调理");

    expect(result).toHaveProperty("response");
    expect(result).toHaveProperty("queryType");
    expect(result).toHaveProperty("docCount");
    expect(typeof result.response).toBe("string");
    expect(result.response.length).toBeGreaterThan(0);
  });

  it("classifies query via queryRouter", async () => {
    const { classifyQuery } = await import("../rag/chain.js");
    await agenticRag("头痛怎么办");

    expect(classifyQuery).toHaveBeenCalledWith("头痛怎么办");
  });

  it("uses rewrites when enableQueryRewrite is true", async () => {
    const { rewriteQuery } = await import("../rag/query-rewriting.js");
    await agenticRag("失眠");

    expect(rewriteQuery).toHaveBeenCalledWith("失眠", 3, "tcm_diagnosis");
  });

  it("returns tcm_diagnosis type for symptom queries", async () => {
    const result = await agenticRag("口干舌燥是怎么回事");
    expect(result.queryType).toBe("tcm_diagnosis");
  });

  it("handles optional chatHistory parameter", async () => {
    const result = await agenticRag("具体怎么用", "问: 什么是桂枝汤\n答: 桂枝汤是解表剂");
    expect(result.response).toBeTruthy();
  });

  it("returns docCount from prepareContext", async () => {
    const result = await agenticRag("失眠");
    expect(result.docCount).toBeGreaterThanOrEqual(0);
  });

  it("streams output via onToken callback", async () => {
    const chunks: string[] = [];
    const result = await agenticRag("失眠", undefined, (chunk) => {
      chunks.push(chunk);
    });

    expect(result.response).toBeTruthy();
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // chunks should concatenate to the full response (minus footnotes)
    expect(chunks.join("")).toContain("心脾两虚");
  });
});

// ================================================================
// deepAnalysis
// ================================================================
describe("deepAnalysis", () => {
  it("returns AnalysisResult with all required fields", async () => {
    const result = await deepAnalysis("失眠的原因分析");

    expect(result).toHaveProperty("conclusion");
    expect(result).toHaveProperty("reasoning");
    expect(result).toHaveProperty("references");
    expect(result).toHaveProperty("confidence");

    expect(typeof result.conclusion).toBe("string");
    expect(typeof result.reasoning).toBe("string");
    expect(Array.isArray(result.references)).toBe(true);
    expect(typeof result.confidence).toBe("number");
  });

  it("returns references array with source/domain entries", async () => {
    const result = await deepAnalysis("桂枝汤");

    for (const ref of result.references) {
      expect(ref).toHaveProperty("source");
      expect(ref).toHaveProperty("domain");
      expect(typeof ref.source).toBe("string");
      expect(typeof ref.domain).toBe("string");
    }
  });

  it("does not throw for empty input", async () => {
    await expect(deepAnalysis("")).resolves.toBeDefined();
  });
});
