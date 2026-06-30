/**
 * 对话持久化存储
 *
 * 将对话记录持久化到 data/conversations.json，
 * 支持跨会话查阅历史、生成上下文摘要供 RAG 使用。
 *
 * 存储结构:
 *   data/
 *     conversations.json  - 对话消息数组
 */

import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

const DATA_DIR = config.dataDir;
const CONVERSATIONS_FILE = path.join(DATA_DIR, "conversations.json");

/** 单条对话消息 */
export interface ConversationMessage {
  id: string;
  timestamp: number;
  role: "user" | "assistant";
  content: string;
  queryType?: string;
  docCount?: number;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadMessages(): ConversationMessage[] {
  ensureDataDir();
  if (!fs.existsSync(CONVERSATIONS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(CONVERSATIONS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function saveMessages(messages: ConversationMessage[]) {
  ensureDataDir();
  fs.writeFileSync(CONVERSATIONS_FILE, JSON.stringify(messages, null, 2), "utf-8");
}

/**
 * 获取最近的对话消息
 * @param limit 最大条数（默认 100）
 */
export function getRecentHistory(limit = 100): ConversationMessage[] {
  const msgs = loadMessages();
  return msgs.slice(-limit);
}

/**
 * 添加一条对话消息（自动保存）
 */
export function addMessage(msg: Omit<ConversationMessage, "id" | "timestamp">) {
  const msgs = loadMessages();
  msgs.push({
    id: `conv_${Date.now()}_${msgs.length}`,
    timestamp: Date.now(),
    ...msg,
  });
  // 超出上限则丢弃最早的
  if (msgs.length > config.maxHistory) msgs.splice(0, msgs.length - config.maxHistory);
  saveMessages(msgs);
}

/**
 * 清空所有对话历史
 */
export function clearHistory() {
  ensureDataDir();
  if (fs.existsSync(CONVERSATIONS_FILE)) fs.unlinkSync(CONVERSATIONS_FILE);
}

/**
 * 生成用于 RAG 上下文的历史摘要
 * @param maxTurns 最大对话轮数（默认 3 轮 = 6 条消息）
 */
export function getHistoryForContext(maxTurns = 3): string | undefined {
  const msgs = loadMessages();
  const recent = msgs.slice(-maxTurns * 2);
  if (recent.length === 0) return undefined;
  return recent.map((m) => `${m.role === "user" ? "问" : "答"}: ${m.content}`).join("\n");
}
