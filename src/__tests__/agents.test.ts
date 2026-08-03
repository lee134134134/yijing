/**
 * Integration tests for agenticRag and deepAnalysis (DeepAgent.js deep mode)
 *
 * Mocks the deepagents boundary (createDeepAgent / createSubAgent) with
 * controllable fake agents, so tests run without LLM/ChromaDB/network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Shared fakes (hoisted so vi.mock factories can reference them) ──
const h = vi.hoisted(() => {
  const agent = {
    streamEvents: vi.fn(),
    invoke: vi.fn(),
  };
  const analyst = { invoke: vi.fn() };
  return { agent, analyst };
});

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
    enableTodoPlanning: true,
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
}));

vi.mock("../vectorstore/chroma.js", () => ({
  searchKnowledge: vi.fn(),
  searchByDomain: vi.fn(),
  multiQuerySearch: vi.fn(),
  getDocumentCount: vi.fn(),
  listCollections: vi.fn(),
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

vi.mock("@langchain/openai", () => ({
  ChatOpenAI: vi.fn(function (this: { bindTools: unknown; invoke: unknown }) {
    this.bindTools = vi.fn().mockReturnThis();
    this.invoke = vi.fn().mockResolvedValue({ content: "mock" });
  }),
}));

// DeepAgent.js boundary: createDeepAgent returns the shared fake agent,
// createSubAgent returns the shared fake analyst.
vi.mock("deepagents", () => ({
  createDeepAgent: vi.fn(() => h.agent),
  createSubAgent: vi.fn(() => h.analyst),
  registerHarnessProfile: vi.fn(),
}));

// ── Fake run helpers (streamEvents v3 shape) ─────────────────────
type FakeToolCall = { name: string; output: string };

function makeFakeRun(text: string, toolCalls: FakeToolCall[] = []) {
  return {
    messages: (async function* () {
      yield {
        text: (async function* () {
          yield text;
        })(),
      };
    })(),
    toolCalls: (async function* () {
      for (const tc of toolCalls) {
        yield { name: tc.name, output: tc.output };
      }
    })(),
    output: Promise.resolve({ messages: [{ content: text }] }),
  };
}

import { buildDeepAgent, buildDeepAnalystAgent, resetDeepAgent } from "../agents/deep-agent.js";
// ── SUT ──────────────────────────────────────────────────────────
import { agenticRag, deepAnalysis } from "../agents/index.js";

beforeEach(() => {
  vi.clearAllMocks();
  resetDeepAgent();
  vi.mocked(h.agent.streamEvents).mockResolvedValue(makeFakeRun("模拟 AI 回答"));
  vi.mocked(h.agent.invoke).mockResolvedValue({ messages: [{ content: "mock" }] });
});

// ================================================================
// agenticRag (deep mode)
// ================================================================
describe("agenticRag (deep mode)", () => {
  it("returns response, queryType and docCount", async () => {
    vi.mocked(h.agent.streamEvents).mockResolvedValue(
      makeFakeRun("归脾汤加减。", [{ name: "search_knowledge_base", output: "【来源】a.md" }]),
    );

    const result = await agenticRag("失眠怎么调理");

    expect(result).toHaveProperty("response");
    expect(result).toHaveProperty("queryType");
    expect(result).toHaveProperty("docCount");
    expect(typeof result.response).toBe("string");
    expect(result.response.length).toBeGreaterThan(0);
    expect(result.queryType).toBe("tcm_diagnosis");
  });

  it("classifies query via classifyQuery", async () => {
    const { classifyQuery } = await import("../rag/chain.js");
    await agenticRag("头痛怎么办");

    expect(classifyQuery).toHaveBeenCalledWith("头痛怎么办");
  });

  it("builds messages from chatHistory and current input", async () => {
    const { agent } = h;
    await agenticRag("具体怎么用", "问: 什么是桂枝汤\n答: 桂枝汤是解表剂");

    const [input, options] = agent.streamEvents.mock.calls[0];
    expect(options).toEqual({ version: "v3" });
    expect(input.messages).toEqual([
      { role: "user", content: "什么是桂枝汤" },
      { role: "assistant", content: "桂枝汤是解表剂" },
      { role: "user", content: "具体怎么用" },
    ]);
  });

  it("counts docCount from retrieval tool outputs (【来源】 anchors)", async () => {
    vi.mocked(h.agent.streamEvents).mockResolvedValue(
      makeFakeRun("回答", [
        { name: "search_knowledge_base", output: "【来源】a.md\n\n---\n\n【来源】b.md" },
        { name: "search_by_domain", output: "【来源】c.md" },
        { name: "other_tool", output: "【来源】x.md" },
      ]),
    );

    const result = await agenticRag("失眠");

    // 两个检索工具共 3 个来源;非检索工具不计入
    expect(result.docCount).toBe(3);
  });

  it("streams output via onToken callback", async () => {
    vi.mocked(h.agent.streamEvents).mockResolvedValue(
      makeFakeRun("失眠多梦属于心脾两虚证，可参考归脾汤加减。", [
        { name: "search_knowledge_base", output: "【来源】a.md" },
      ]),
    );

    const chunks: string[] = [];
    const result = await agenticRag("失眠", undefined, (chunk) => {
      chunks.push(chunk);
    });

    expect(result.response).toBeTruthy();
    expect(chunks.join("")).toContain("心脾两虚");
  });

  it("keeps [ref-N] citations in the response", async () => {
    const cited = "失眠多梦属心脾两虚，参考归脾汤[ref-1]。\n\n参考来源:\n[ref-1] zhongyi_xin.md — 不寐";
    vi.mocked(h.agent.streamEvents).mockResolvedValue(
      makeFakeRun(cited, [{ name: "search_knowledge_base", output: "【来源】a.md" }]),
    );

    const result = await agenticRag("失眠");

    expect(result.response).toContain("[ref-1]");
  });

  it("falls back to no-result message when no retrieval and no citation", async () => {
    vi.mocked(h.agent.streamEvents).mockResolvedValue(makeFakeRun("抱歉,我不太清楚这个问题。"));

    const result = await agenticRag("倪海厦关于汽车风水怎么看");

    expect(result.response).toContain("未检索到");
    expect(result.docCount).toBe(0);
  });

  it("does not fall back when response already contains citations", async () => {
    const cited = "相关论述见[ref-1]。";
    vi.mocked(h.agent.streamEvents).mockResolvedValue(makeFakeRun(cited));

    const result = await agenticRag("失眠");

    expect(result.response).toBe(cited);
  });

  it("builds the deep agent exactly once (singleton)", async () => {
    const { createDeepAgent } = await import("deepagents");
    await agenticRag("问题A");
    await agenticRag("问题B");

    expect(createDeepAgent).toHaveBeenCalledTimes(1);
    expect(buildDeepAgent()).toBe(h.agent);
  });
});

// ================================================================
// deepAnalysis (deep mode)
// ================================================================
describe("deepAnalysis (deep mode)", () => {
  it("returns AnalysisResult parsed from json_object final message", async () => {
    vi.mocked(h.analyst.invoke).mockResolvedValue({
      messages: [
        {
          content: JSON.stringify({
            conclusion: "脾肾阳虚,治宜温补脾肾",
            reasoning: "1. 阳虚则寒...",
            references: [{ source: "zhongyi_xin.md", content: "脾肾阳虚...", domain: "中医临床" }],
            confidence: 0.85,
            suggestions: ["附子理中丸", "艾灸关元"],
          }),
        },
      ],
    });

    const result = await deepAnalysis("分析脾肾阳虚的辨证要点");

    expect(result.conclusion).toBe("脾肾阳虚,治宜温补脾肾");
    expect(result.reasoning).toBe("1. 阳虚则寒...");
    expect(result.references).toHaveLength(1);
    expect(result.references[0]).toMatchObject({ source: "zhongyi_xin.md", domain: "中医临床" });
    expect(result.confidence).toBe(0.85);
    expect(result.suggestions).toEqual(["附子理中丸", "艾灸关元"]);
  });

  it("builds the analyst agent via createSubAgent (singleton)", async () => {
    const { createSubAgent } = await import("deepagents");
    await deepAnalysis("测试");

    expect(createSubAgent).toHaveBeenCalledTimes(1);
    expect(buildDeepAnalystAgent()).toBe(h.analyst);
  });

  it("falls back to last message text when content is not valid JSON", async () => {
    vi.mocked(h.analyst.invoke).mockResolvedValue({
      messages: [{ content: "文本形式的结果" }],
    });

    const result = await deepAnalysis("分析");

    expect(result.conclusion).toBe("文本形式的结果");
    expect(result.confidence).toBe(0.5);
    expect(Array.isArray(result.references)).toBe(true);
  });

  it("does not throw for empty input", async () => {
    vi.mocked(h.analyst.invoke).mockResolvedValue({
      structuredResponse: { conclusion: "ok", reasoning: "", references: [], confidence: 0.5 },
      messages: [],
    });

    await expect(deepAnalysis("")).resolves.toBeDefined();
  });
});
