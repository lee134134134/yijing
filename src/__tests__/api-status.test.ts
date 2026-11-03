/**
 * GET /api/status 路由测试
 */

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getStoreHealth: vi.fn(),
  getLlmStatus: vi.fn(),
}));

vi.mock("../vectorstore/chroma.js", () => ({ getStoreHealth: h.getStoreHealth }));
vi.mock("../llm/factory.js", () => ({ getLlmStatus: h.getLlmStatus }));

vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  createRequestContext: () => ({ requestId: "test-request" }),
  logRequestComplete: vi.fn(),
}));

import { statusRoutes } from "../api/routes/status.js";

async function buildApp() {
  const app = Fastify();
  await app.register(statusRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.getStoreHealth.mockResolvedValue({
    ok: true,
    collectionName: "yijing_knowledge_v1",
    chroma: true,
    collection: true,
    docCount: 42,
    collections: ["yijing_knowledge_v1"],
    manifest: { ok: true },
  });
  h.getLlmStatus.mockReturnValue([
    {
      role: "main",
      provider: "deepseek",
      model: "deepseek-chat",
      baseUrl: "https://api.deepseek.com",
      jsonMode: false,
    },
    { role: "deep", provider: "deepseek", model: "deepseek-chat", baseUrl: "https://api.deepseek.com", jsonMode: true },
    {
      role: "classify",
      provider: "deepseek",
      model: "deepseek-chat",
      baseUrl: "https://api.deepseek.com",
      jsonMode: false,
    },
    {
      role: "rewrite",
      provider: "deepseek",
      model: "deepseek-chat",
      baseUrl: "https://api.deepseek.com",
      jsonMode: false,
    },
  ]);
});

describe("GET /api/status", () => {
  it("返回索引/健康/LLM 状态", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/status" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      docCount: 42,
      collections: ["yijing_knowledge_v1"],
      health: {
        chroma: { ok: true },
        llm: { ok: true },
        manifest: { ok: true },
      },
      index: { collection: "yijing_knowledge_v1", exists: true, docCount: 42 },
    });
    expect(body.llm).toHaveLength(4);
    await app.close();
  });

  it("存储探测抛错 → 500", async () => {
    h.getStoreHealth.mockRejectedValue(new Error("boom"));
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/status" });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
    await app.close();
  });
});
