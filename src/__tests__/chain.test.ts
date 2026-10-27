/**
 * RAG 链单元测试(chain.ts)
 *
 * 覆盖统一模型工厂(getChatModel)的配置接线与查询类型白名单规整。
 * LLM 调用本身由 mock 边界隔离,测试离线可重复。
 */

import { describe, expect, it, vi } from "vitest";

const captured: Array<Record<string, unknown>> = [];

vi.mock("../config.js", () => ({
  config: {
    llmModel: "gpt-4o-mini",
    llmTemperature: 0.3,
    llmMaxRetries: 5,
    openaiBaseUrl: "http://localhost:8000/v1",
    openaiApiKey: "test-key",
  },
}));

// ChatOpenAI 边界:仅捕获构造参数,不发任何网络请求
vi.mock("@langchain/openai", () => ({
  ChatOpenAI: vi.fn(function (this: unknown, params: Record<string, unknown>) {
    Object.assign(this as object, params);
    captured.push(params);
  }),
}));

import { getChatModel, normalizeQueryType } from "../rag/chain.js";

describe("rag/chain", () => {
  describe("getChatModel", () => {
    it("将 config 的重试/模型/连接配置接入 ChatOpenAI", () => {
      captured.length = 0;
      getChatModel();

      expect(captured[0]).toMatchObject({
        model: "gpt-4o-mini",
        temperature: 0.3,
        // 此前 llmMaxRetries 有配置但从未接线,限流/5xx 会裸抛到业务层
        maxRetries: 5,
      });
      expect(captured[0]?.configuration).toMatchObject({
        baseURL: "http://localhost:8000/v1",
        apiKey: "test-key",
      });
    });

    it("支持覆盖模型与透传 modelKwargs", () => {
      captured.length = 0;
      getChatModel({
        model: "deep-model",
        temperature: 0.1,
        modelKwargs: { response_format: { type: "json_object" } },
      });

      expect(captured[0]).toMatchObject({ model: "deep-model", temperature: 0.1, maxRetries: 5 });
      expect(captured[0]?.modelKwargs).toEqual({ response_format: { type: "json_object" } });
    });
  });

  describe("normalizeQueryType", () => {
    it("归一化空白与大小写", () => {
      expect(normalizeQueryType("  TCM_Diagnosis ")).toBe("tcm_diagnosis");
      expect(normalizeQueryType("General_Knowledge")).toBe("general_knowledge");
    });

    it("白名单外一律 unknown(防模型杂值流入 API 响应)", () => {
      expect(normalizeQueryType("")).toBe("unknown");
      expect(normalizeQueryType("这是一段废话")).toBe("unknown");
      expect(normalizeQueryType("tcm_diagnosisextra")).toBe("unknown");
      expect(normalizeQueryType("deep_analysis")).toBe("deep_analysis");
    });
  });
});
