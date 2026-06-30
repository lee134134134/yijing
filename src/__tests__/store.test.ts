import fs from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = vi.hoisted(() => {
  const fs = require("node:fs");
  return fs.mkdtempSync("/tmp/yijing-store-test-");
});

vi.mock("../config.js", () => ({
  config: {
    maxHistory: 10,
    dataDir: tmpDir,
  },
}));

import { addMessage, clearHistory, getHistoryForContext, getRecentHistory } from "../conversation/store.js";

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("conversation store", () => {
  beforeEach(() => {
    const convFile = `${tmpDir}/conversations.json`;
    if (fs.existsSync(convFile)) {
      fs.unlinkSync(convFile);
    }
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
    expect(history[0].id).toMatch(/^conv_\d+_\d+$/);
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
    expect(history.length).toBeLessThanOrEqual(11);
  });

  it("getRecentHistory respects limit parameter", () => {
    for (let i = 0; i < 20; i++) {
      addMessage({ role: "user", content: `msg ${i}` });
    }

    const limited = getRecentHistory(5);
    expect(limited).toHaveLength(5);
    expect(limited[0].content).toBe("msg 15");
  });

  it("getHistoryForContext returns recent turns", () => {
    addMessage({ role: "user", content: "Q1" });
    addMessage({ role: "assistant", content: "A1" });
    addMessage({ role: "user", content: "Q2" });
    addMessage({ role: "assistant", content: "A2" });

    const context = getHistoryForContext(2);
    expect(context).toContain("问: Q1");
    expect(context).toContain("答: A1");
    expect(context).toContain("问: Q2");
    expect(context).toContain("答: A2");
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
