/**
 * POST /api/deep 路由测试
 */

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ deepAnalysis: vi.fn() }));

vi.mock("../agents/index.js", () => ({ deepAnalysis: h.deepAnalysis }));

vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  createRequestContext: () => ({ requestId: "test-request" }),
  logRequestComplete: vi.fn(),
}));

import { deepRoutes } from "../api/routes/deep.js";
import { ErrorCode, LLMError } from "../errors.js";

async function buildApp() {
  const app = Fastify();
  await app.register(deepRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.deepAnalysis.mockResolvedValue({
    conclusion: "脾肾阳虚",
    reasoning: "阳虚则寒",
    references: [{ source: "zhongyi_xin.md", content: "…", domain: "中医临床", refId: "abcd1234" }],
    confidence: 0.8,
    suggestions: ["温补脾肾"],
  });
});

describe("POST /api/deep", () => {
  it("成功 → 200 + 结构化结果", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/deep", payload: { query: "脾肾阳虚怎么辨" } });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      conclusion: "脾肾阳虚",
      reasoning: "阳虚则寒",
      confidence: 0.8,
      references: [{ source: "zhongyi_xin.md", refId: "abcd1234" }],
    });
    expect(typeof res.json().elapsed).toBe("number");
    expect(h.deepAnalysis).toHaveBeenCalledWith("脾肾阳虚怎么辨");
    await app.close();
  });

  it("空 query → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/deep", payload: { query: "   " } });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: "INVALID_INPUT" } });
    expect(h.deepAnalysis).not.toHaveBeenCalled();
    await app.close();
  });

  it("LLMError → 对应状态码与错误码", async () => {
    h.deepAnalysis.mockRejectedValue(new LLMError(ErrorCode.LLM_TIMEOUT, "上游超时"));
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/deep", payload: { query: "分析" } });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: { code: "LLM_TIMEOUT" } });
    await app.close();
  });
});
