import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = vi.hoisted(() => {
  const fs = require("node:fs");
  return fs.mkdtempSync("/tmp/yijing-store-test-");
});

vi.mock("../config.js", () => ({
  config: {
    maxHistory: 10,
    sqlitePath: path.join(tmpDir, "test.db"),
  },
}));

import {
  addConversationMessage,
  addMessage,
  clearHistory,
  createConversation,
  deleteConversation,
  getConversation,
  getHistoryForContext,
  getHistoryForConversation,
  getMessages,
  getRecentHistory,
  listConversations,
  renameConversation,
} from "../conversation/store.js";

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("conversation store", () => {
  beforeEach(() => {
    clearHistory();
  });

  it("adds a message and retrieves it", () => {
    addMessage({ role: "user", content: "桂枝汤的组成？" });
    addMessage({ role: "assistant", content: "桂枝汤由桂枝、芍药...", docCount: 3 });

    const history = getRecentHistory();
    expect(history).toHaveLength(2);
    expect(history[0].role).toBe("user");
    expect(history[0].content).toBe("桂枝汤的组成？");
    expect(history[1].role).toBe("assistant");
    expect(history[1].docCount).toBe(3);
  });

  it("assigns id and timestamp automatically", () => {
    addMessage({ role: "user", content: "test" });
    const history = getRecentHistory();
    expect(history[0].id).toMatch(/^msg_\d+_[a-z0-9]+$/);
    expect(history[0].timestamp).toBeGreaterThan(0);
  });

  it("stores queryType when provided", () => {
    addMessage({ role: "user", content: "症状分析", queryType: "tcm_diagnosis" });
    const history = getRecentHistory();
    expect(history[0].queryType).toBe("tcm_diagnosis");
  });

  it("enforces maxHistory via config", () => {
    for (let i = 0; i < 15; i++) {
      addMessage({ role: "user", content: `msg ${i}` });
    }

    const history = getRecentHistory();
    expect(history.length).toBeLessThanOrEqual(10);
  });

  it("getRecentHistory respects limit parameter", () => {
    for (let i = 0; i < 20; i++) {
      addMessage({ role: "user", content: `msg ${i}` });
    }

    const limited = getRecentHistory(5);
    expect(limited).toHaveLength(5);
    expect(limited[0].content).toBe("msg 15");
  });

  it("getHistoryForContext returns recent turns as JSON messages", () => {
    addMessage({ role: "user", content: "Q1" });
    addMessage({ role: "assistant", content: "A1" });
    addMessage({ role: "user", content: "Q2" });
    addMessage({ role: "assistant", content: "A2" });

    const context = getHistoryForContext(2);

    expect(context).toBeDefined();
    expect(JSON.parse(context ?? "[]")).toEqual([
      { role: "user", content: "Q1" },
      { role: "assistant", content: "A1" },
      { role: "user", content: "Q2" },
      { role: "assistant", content: "A2" },
    ]);
  });

  it("消息内容含换行与 问:/答: 前缀行时无解析歧义(JSON 格式核心价值)", () => {
    addMessage({ role: "assistant", content: "歌诀:\n问: 何为桂枝汤?\n答: 解表之剂" });

    const parsed = JSON.parse(getHistoryForContext(1) ?? "[]");

    expect(parsed).toEqual([{ role: "assistant", content: "歌诀:\n问: 何为桂枝汤?\n答: 解表之剂" }]);
  });

  it("getHistoryForContext returns undefined for empty history", () => {
    expect(getHistoryForContext()).toBeUndefined();
  });

  it("clearHistory removes all messages", () => {
    addMessage({ role: "user", content: "test" });
    clearHistory();
    expect(getRecentHistory()).toHaveLength(0);
  });
});

describe("conversation v2", () => {
  beforeEach(() => {
    clearHistory();
  });

  it("创建 / 列表 / 详情", () => {
    const created = createConversation("桂枝汤讨论");
    expect(created.id).toMatch(/^conv_\d+_[a-z0-9]+$/);
    expect(created.title).toBe("桂枝汤讨论");

    const list = listConversations();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(created.id);

    expect(getConversation(created.id)?.title).toBe("桂枝汤讨论");
    expect(getConversation("missing")).toBeNull();
  });

  it("消息按时间正序返回,并可生成会话历史", () => {
    const conversation = createConversation("测试");
    addConversationMessage(conversation.id, { role: "user", content: "Q1" });
    addConversationMessage(conversation.id, { role: "assistant", content: "A1" });
    addConversationMessage(conversation.id, { role: "user", content: "Q2" });

    const messages = getMessages(conversation.id);
    expect(messages.map((m) => m.content)).toEqual(["Q1", "A1", "Q2"]);

    const context = getHistoryForConversation(conversation.id, 2);
    expect(JSON.parse(context ?? "[]")).toEqual([
      { role: "user", content: "Q1" },
      { role: "assistant", content: "A1" },
      { role: "user", content: "Q2" },
    ]);
  });

  it("messages 支持 limit 与 before 翻页", async () => {
    const conversation = createConversation("分页");
    for (let i = 0; i < 5; i++) {
      addConversationMessage(conversation.id, { role: "user", content: `m${i}` });
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    const all = getMessages(conversation.id, 10);
    const page = getMessages(conversation.id, 2, all[2]?.timestamp);
    expect(page.map((m) => m.content)).toEqual(["m0", "m1"]);
  });

  it("重命名会话", () => {
    const conversation = createConversation("旧标题");
    expect(renameConversation(conversation.id, "新标题")).toBe(true);
    expect(getConversation(conversation.id)?.title).toBe("新标题");
    expect(renameConversation("missing", "x")).toBe(false);
  });

  it("软删除后列表与详情不可见", () => {
    const conversation = createConversation("待删除");
    expect(deleteConversation(conversation.id)).toBe(true);
    expect(listConversations()).toHaveLength(0);
    expect(getConversation(conversation.id)).toBeNull();
    expect(deleteConversation(conversation.id)).toBe(false);
  });
});
