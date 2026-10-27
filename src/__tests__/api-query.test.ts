/**
 * POST /api/query 路由测试(非流式 + SSE 流式)
 *
 * 全程离线:mock agenticRag 与 logger。SSE 用例走真实 HTTP(port 0)
 * 读取响应流(路由内 reply.hijack() 后 inject 无法稳定捕获),验证
 * 事件帧格式、错误路径与快路径无心跳帧。
 */
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Shared fakes (hoisted so vi.mock factories can reference them) ──
const h = vi.hoisted(() => ({ agenticRag: vi.fn() }));

vi.mock("../agents/index.js", () => ({ agenticRag: h.agenticRag }));

vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  createRequestContext: () => ({ requestId: "test-request" }),
  logRequestComplete: vi.fn(),
}));

import { queryRoutes } from "../api/routes/query.js";
import { ErrorCode, LLMError } from "../errors.js";

async function buildApp() {
  const app = Fastify();
  await app.register(queryRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ================================================================
// 非流式
// ================================================================
describe("POST /api/query (非流式)", () => {
  it("缺 query 或纯空白 → 400,不触发 agenticRag", async () => {
    const app = await buildApp();

    const r1 = await app.inject({ method: "POST", url: "/query", payload: {} });
    expect(r1.statusCode).toBe(400);
    expect(r1.json()).toMatchObject({ error: { code: "INVALID_INPUT" } });

    const r2 = await app.inject({ method: "POST", url: "/query", payload: { query: "   " } });
    expect(r2.statusCode).toBe(400);

    expect(h.agenticRag).not.toHaveBeenCalled();
    await app.close();
  });

  it("成功 → 200,返回 response/queryType/docCount/elapsed", async () => {
    h.agenticRag.mockResolvedValue({ response: "归脾汤加减。", queryType: "tcm_prescription", docCount: 2 });
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: "/query", payload: { query: "失眠怎么调理" } });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ response: "归脾汤加减。", queryType: "tcm_prescription", docCount: 2 });
    expect(typeof body.elapsed).toBe("number");
    expect(h.agenticRag).toHaveBeenCalledWith("失眠怎么调理");
    await app.close();
  });

  it("YijingError 子类 → 对应 statusCode 与 error.code", async () => {
    h.agenticRag.mockRejectedValue(new LLMError(ErrorCode.LLM_TIMEOUT, "上游超时"));
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: "/query", payload: { query: "失眠" } });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: { code: "LLM_TIMEOUT" } });
    await app.close();
  });

  it("非 YijingError 异常 → 500 INTERNAL_ERROR(不透出内部细节)", async () => {
    h.agenticRag.mockRejectedValue(new Error("secret internal detail"));
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: "/query", payload: { query: "失眠" } });

    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("secret internal detail");
    await app.close();
  });
});

// ================================================================
// SSE 流式(真实 HTTP)
// ================================================================
describe("POST /api/query (SSE 流式)", () => {
  it("流式成功:message 帧逐 chunk + meta + done,且无心跳帧", async () => {
    h.agenticRag.mockImplementation(async (_q: string, _history: string | undefined, onToken?: (c: string) => void) => {
      onToken?.("你");
      onToken?.("好");
      return { response: "你好", queryType: "general_knowledge", docCount: 1 };
    });

    const app = await buildApp();
    const base = await app.listen({ port: 0, host: "127.0.0.1" });
    try {
      const res = await fetch(`${base}/query`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "你好", stream: true }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");

      const text = await res.text();
      expect(text).toContain("event: message");
      expect(text).toContain('data: {"type":"text","data":"你"}');
      expect(text).toContain('data: {"type":"text","data":"好"}');
      expect(text).toContain("event: meta");
      expect(text).toContain('"queryType":"general_knowledge"');
      expect(text).toContain("event: done");
      expect(text).toContain('"response":"你好"');
      // 快路径(毫秒级)不应触发 25s 心跳
      expect(text).not.toContain(":ping");
    } finally {
      await app.close();
    }
  });

  it("流式失败:发送 event: error 且含错误码,不发 done", async () => {
    h.agenticRag.mockRejectedValue(new LLMError(ErrorCode.LLM_RATE_LIMITED, "限流"));

    const app = await buildApp();
    const base = await app.listen({ port: 0, host: "127.0.0.1" });
    try {
      const res = await fetch(`${base}/query`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "失眠", stream: true }),
      });

      // 头部已 hijack 写出(200),错误通过 SSE 帧传递
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("event: error");
      expect(text).toContain('"code":"LLM_RATE_LIMITED"');
      expect(text).not.toContain("event: done");
    } finally {
      await app.close();
    }
  });
});
