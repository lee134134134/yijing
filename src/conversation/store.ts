/**
 * 对话持久化存储
 *
 * 使用 better-sqlite3 将对话记录持久化到 SQLite 数据库，
 * 支持并发安全访问、跨会话查阅历史、生成上下文摘要供 RAG 使用。
 *
 * 表结构:
 *   conversations
 *     id         TEXT PRIMARY KEY
 *     timestamp  INTEGER
 *     role       TEXT
 *     content    TEXT
 *     query_type TEXT
 *     doc_count  INTEGER
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "../config.js";
import { StoreError } from "../errors.js";
import { createLogger } from "../logger.js";

const log = createLogger("conversation:store");

const DB_DIR = path.dirname(config.sqlitePath);

/** 单条对话消息 */
export interface ConversationMessage {
  id: string;
  timestamp: number;
  role: "user" | "assistant";
  content: string;
  queryType?: string;
  docCount?: number;
}

function ensureDbDir() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
}

function createDatabase(): Database.Database {
  ensureDbDir();
  const db = new Database(config.sqlitePath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      query_type TEXT,
      doc_count INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_conversations_timestamp ON conversations(timestamp);
  `);
  return db;
}

let db: Database.Database;
try {
  db = createDatabase();
  log.info({ sqlitePath: config.sqlitePath }, "Conversation store initialized");
} catch (err) {
  log.fatal({ err, sqlitePath: config.sqlitePath }, "Failed to initialize conversation store");
  throw new StoreError("Failed to initialize conversation store", { cause: err });
}

type ConversationRow = {
  id: string;
  timestamp: number;
  role: string;
  content: string;
  query_type: string | null;
  doc_count: number | null;
};

function rowToMessage(row: ConversationRow): ConversationMessage {
  const msg: ConversationMessage = {
    id: row.id,
    timestamp: row.timestamp,
    role: row.role as "user" | "assistant",
    content: row.content,
  };
  if (row.query_type !== null) msg.queryType = row.query_type;
  if (row.doc_count !== null) msg.docCount = row.doc_count;
  return msg;
}

/**
 * 获取最近的对话消息
 * @param limit 最大条数（默认 100）
 */
export function getRecentHistory(limit = 100): ConversationMessage[] {
  try {
    const rows = db
      .prepare("SELECT id, timestamp, role, content, query_type, doc_count FROM conversations ORDER BY timestamp ASC")
      .all() as ConversationRow[];
    return rows.slice(-limit).map(rowToMessage);
  } catch (err) {
    log.error({ err }, "Failed to retrieve conversation history");
    throw new StoreError("Failed to retrieve conversation history", { cause: err });
  }
}

/**
 * 添加一条对话消息（自动保存）
 */
export function addMessage(msg: Omit<ConversationMessage, "id" | "timestamp">) {
  try {
    const timestamp = Date.now();
    const count = db.prepare("SELECT COUNT(*) as count FROM conversations").get() as {
      count: number;
    };
    const id = `conv_${timestamp}_${count.count}_${Math.random().toString(36).slice(2, 8)}`;

    const insert = db.prepare(
      "INSERT INTO conversations (id, timestamp, role, content, query_type, doc_count) VALUES (?, ?, ?, ?, ?, ?)",
    );
    insert.run(id, timestamp, msg.role, msg.content, msg.queryType ?? null, msg.docCount ?? null);

    // 超出上限则丢弃最早的记录
    const maxHistory = config.maxHistory;
    const excess = count.count + 1 - maxHistory;
    if (excess > 0) {
      db.prepare(
        "DELETE FROM conversations WHERE id IN (SELECT id FROM conversations ORDER BY timestamp ASC LIMIT ?)",
      ).run(excess);
    }
  } catch (err) {
    log.error({ err, msg }, "Failed to add conversation message");
    throw new StoreError("Failed to add conversation message", { cause: err });
  }
}

/**
 * 清空所有对话历史
 */
export function clearHistory() {
  try {
    db.prepare("DELETE FROM conversations").run();
    log.info("Conversation history cleared");
  } catch (err) {
    log.error({ err }, "Failed to clear conversation history");
    throw new StoreError("Failed to clear conversation history", { cause: err });
  }
}

/**
 * 生成用于 RAG 上下文的历史消息（JSON 消息数组字符串）
 *
 * 使用 JSON 而非 "问:/答:" 文本拼接：消息内容本身可能包含换行和 "问: "
 * 前缀行，文本格式会被消费端误解析成多条消息；JSON 结构无此歧义。
 * 消费端（agents/index.ts parseChatHistory）兼容旧文本格式。
 * @param maxTurns 最大对话轮数（默认 3 轮 = 6 条消息）
 */
export function getHistoryForContext(maxTurns = 3): string | undefined {
  try {
    const rows = db
      .prepare("SELECT role, content FROM conversations ORDER BY timestamp DESC LIMIT ?")
      .all(maxTurns * 2) as Array<{ role: "user" | "assistant"; content: string }>;
    if (rows.length === 0) return undefined;
    return JSON.stringify(rows.reverse().map((m) => ({ role: m.role, content: m.content })));
  } catch (err) {
    log.error({ err }, "Failed to build history context");
    throw new StoreError("Failed to build history context", { cause: err });
  }
}
