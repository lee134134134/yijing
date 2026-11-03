/**
 * 会话 API 测试
 *
 * mock conversation store,验证路由契约(201/200/404、软删、消息分页)。
 */

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  createConversation: vi.fn(),
  listConversations: vi.fn(),
  getConversation: vi.fn(),
  getMessages: vi.fn(),
  renameConversation: vi.fn(),
  deleteConversation: vi.fn(),
}));

vi.mock("../conversation/index.js", () => ({
  createConversation: h.createConversation,
  listConversations: h.listConversations,
  getConversation: h.getConversation,
  getMessages: h.getMessages,
  renameConversation: h.renameConversation,
  deleteConversation: h.deleteConversation,
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  createRequestContext: () => ({ requestId: "test-request" }),
  logRequestComplete: vi.fn(),
}));

import { conversationRoutes } from "../api/routes/conversations.js";

const conversation = {
  id: "conv_1",
  title: "测试会话",
  createdAt: 1,
  updatedAt: 1,
  messageCount: 0,
};

async function buildApp() {
  const app = Fastify();
  await app.register(conversationRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.createConversation.mockReturnValue(conversation);
  h.listConversations.mockReturnValue([conversation]);
  h.getConversation.mockReturnValue(conversation);
  h.getMessages.mockReturnValue([{ id: "msg_1", timestamp: 1, role: "user", content: "你好" }]);
  h.renameConversation.mockReturnValue(true);
  h.deleteConversation.mockReturnValue(true);
});

describe("conversation routes", () => {
  it("POST /conversations → 201", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/conversations", payload: { title: "新会话" } });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ conversation: { id: "conv_1" } });
    expect(h.createConversation).toHaveBeenCalledWith("新会话");
    await app.close();
  });

  it("POST /conversations 无 title → 默认标题", async () => {
    const app = await buildApp();
    await app.inject({ method: "POST", url: "/conversations", payload: {} });
    expect(h.createConversation).toHaveBeenCalledWith("新对话");
    await app.close();
  });

  it("GET /conversations → 列表 + total", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/conversations?limit=10" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ total: 1, conversations: [{ id: "conv_1" }] });
    expect(h.listConversations).toHaveBeenCalledWith(10);
    await app.close();
  });

  it("GET /conversations/:id 不存在 → 404", async () => {
    h.getConversation.mockReturnValue(null);
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/conversations/missing" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
    await app.close();
  });

  it("GET /conversations/:id/messages → 消息", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/conversations/conv_1/messages?limit=20" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ messages: [{ id: "msg_1", content: "你好" }] });
    expect(h.getMessages).toHaveBeenCalledWith("conv_1", 20, undefined);
    await app.close();
  });

  it("PATCH /conversations/:id → 重命名", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "PATCH", url: "/conversations/conv_1", payload: { title: "改名" } });

    expect(res.statusCode).toBe(200);
    expect(h.renameConversation).toHaveBeenCalledWith("conv_1", "改名");
    await app.close();
  });

  it("PATCH 不存在 → 404", async () => {
    h.renameConversation.mockReturnValue(false);
    const app = await buildApp();
    const res = await app.inject({ method: "PATCH", url: "/conversations/missing", payload: { title: "x" } });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("DELETE /conversations/:id → 软删", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: "/conversations/conv_1" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
    expect(h.deleteConversation).toHaveBeenCalledWith("conv_1");
    await app.close();
  });

  it("DELETE 不存在 → 404", async () => {
    h.deleteConversation.mockReturnValue(false);
    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: "/conversations/missing" });

    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
