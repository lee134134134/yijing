/**
 * 历史记录 API 路由测试
 */

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getRecentHistory: vi.fn(),
  clearHistory: vi.fn(),
}));

vi.mock("../conversation/index.js", () => ({
  getRecentHistory: h.getRecentHistory,
  clearHistory: h.clearHistory,
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  createRequestContext: () => ({ requestId: "test-request" }),
  logRequestComplete: vi.fn(),
}));

import { historyRoutes } from "../api/routes/history.js";

async function buildApp() {
  const app = Fastify();
  await app.register(historyRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.getRecentHistory.mockReturnValue([
    { id: "msg_1", timestamp: 1, role: "user", content: "你好" },
    { id: "msg_2", timestamp: 2, role: "assistant", content: "你好，有什么可以帮你" },
  ]);
});

describe("history routes", () => {
  it("GET /history → 列表与总数", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/history?limit=5" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ total: 2 });
    expect(h.getRecentHistory).toHaveBeenCalledWith(5);
    await app.close();
  });

  it("GET /history 非法 limit → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/history?limit=abc" });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("DELETE /history → 清空", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: "/history" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
    expect(h.clearHistory).toHaveBeenCalled();
    await app.close();
  });
});
