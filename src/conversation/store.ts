/**
 * 对话持久化存储(SQLite, schema v2)
 *
 * v1(旧): conversations 表把"会话"和"消息"混在一起(id/timestamp/role/content...)。
 * v2: conversations + messages 两张表,支持多会话、消息分页、引用/耗时/降级状态。
 *
 * 兼容:
 * - 首次启动自动迁移:旧表重命名为 legacy_messages,数据导入 "历史记录" 会话
 * - addMessage / getRecentHistory / getHistoryForContext 保留,供 CLI/TUI 使用,
 *   写入固定的 "cli" 会话
 *
 * 约束:单机自用,不做 owner 隔离;将来开放时给 conversations 加 owner_key 即可。
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "../config.js";
import { StoreError } from "../errors.js";
import { createLogger } from "../logger.js";
import type { Citation } from "../types.js";

const log = createLogger("conversation:store");

const DB_DIR = path.dirname(config.sqlitePath);
const DEFAULT_CONVERSATION_ID = "cli";
const DEFAULT_CONVERSATION_TITLE = "CLI 会话";
const LEGACY_CONVERSATION_ID = "legacy";

/** 单条对话消息 */
export interface ConversationMessage {
  id: string;
  timestamp: number;
  role: "user" | "assistant";
  content: string;
  queryType?: string;
  docCount?: number;
  citations?: Citation[];
  degraded?: boolean;
  model?: string;
  latencyMs?: number;
}

/** 会话摘要 */
export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

/** 新增消息入参 */
export interface NewMessage {
  role: "user" | "assistant";
  content: string;
  queryType?: string;
  docCount?: number;
  citations?: Citation[];
  degraded?: boolean;
  model?: string;
  latencyMs?: number;
}

function ensureDbDir(): void {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

/**
 * 迁移到 schema v2
 *
 * 只跑一次;旧表保留为 legacy_messages 以便回滚/审计。
 */
function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const hasMessages = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='messages'").get() as
    | { name: string }
    | undefined;
  if (hasMessages) return;

  const hasLegacy = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='conversations'").get() as
    | { name: string }
    | undefined;

  const runMigration = db.transaction(() => {
    if (hasLegacy) {
      db.exec("ALTER TABLE conversations RENAME TO legacy_messages");
    }

    db.exec(`
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );

      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        query_type TEXT,
        doc_count INTEGER,
        citations_json TEXT,
        degraded INTEGER NOT NULL DEFAULT 0,
        model TEXT,
        latency_ms INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX idx_messages_conv ON messages(conversation_id, created_at);
      CREATE INDEX idx_messages_created ON messages(created_at);
    `);

    if (hasLegacy) {
      const stats = db
        .prepare("SELECT MIN(timestamp) AS minTs, MAX(timestamp) AS maxTs FROM legacy_messages")
        .get() as { minTs: number | null; maxTs: number | null };
      const now = Date.now();
      db.prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
        LEGACY_CONVERSATION_ID,
        "历史记录",
        stats.minTs ?? now,
        stats.maxTs ?? now,
      );
      db.exec(`
        INSERT INTO messages
          (id, conversation_id, role, content, query_type, doc_count, citations_json, degraded, model, latency_ms, created_at)
        SELECT
          id, '${LEGACY_CONVERSATION_ID}', role, content, query_type, doc_count, NULL, 0, NULL, NULL, timestamp
        FROM legacy_messages
      `);
      log.info({ legacyRows: stats }, "Migrated legacy conversations");
    }

    db.prepare("INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (1, ?)").run(Date.now());
  });

  runMigration();
  log.info("Conversation schema migrated to v2");
}

function createDatabase(): Database.Database {
  ensureDbDir();
  const db = new Database(config.sqlitePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
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
  title: string;
  created_at: number;
  updated_at: number;
  message_count?: number;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  created_at: number;
  role: string;
  content: string;
  query_type: string | null;
  doc_count: number | null;
  citations_json: string | null;
  degraded: number;
  model: string | null;
  latency_ms: number | null;
};

function rowToConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: row.message_count ?? 0,
  };
}

function rowToMessage(row: MessageRow): ConversationMessage {
  const message: ConversationMessage = {
    id: row.id,
    timestamp: row.created_at,
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.content,
  };
  if (row.query_type !== null) message.queryType = row.query_type;
  if (row.doc_count !== null) message.docCount = row.doc_count;
  if (row.degraded) message.degraded = true;
  if (row.model !== null) message.model = row.model;
  if (row.latency_ms !== null) message.latencyMs = row.latency_ms;
  if (row.citations_json) {
    try {
      message.citations = JSON.parse(row.citations_json) as Citation[];
    } catch {
      log.warn({ messageId: row.id }, "Failed to parse citations_json");
    }
  }
  return message;
}

/** 创建会话 */
export function createConversation(title = "新对话"): Conversation {
  const now = Date.now();
  const id = `conv_${now}_${randomSuffix()}`;
  try {
    db.prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
      id,
      title.trim() || "新对话",
      now,
      now,
    );
    return { id, title, createdAt: now, updatedAt: now, messageCount: 0 };
  } catch (err) {
    log.error({ err }, "Failed to create conversation");
    throw new StoreError("Failed to create conversation", { cause: err });
  }
}

/** 确保固定会话存在(CLI / legacy) */
function ensureConversation(id: string, title: string): void {
  const now = Date.now();
  db.prepare("INSERT OR IGNORE INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
    id,
    title,
    now,
    now,
  );
}

/** 会话列表(不含已软删) */
export function listConversations(limit = 50): Conversation[] {
  try {
    const rows = db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
         FROM conversations c
         WHERE c.deleted_at IS NULL
         ORDER BY c.updated_at DESC
         LIMIT ?`,
      )
      .all(limit) as ConversationRow[];
    return rows.map(rowToConversation);
  } catch (err) {
    log.error({ err }, "Failed to list conversations");
    throw new StoreError("Failed to list conversations", { cause: err });
  }
}

/** 读取单个会话(已软删返回 null) */
export function getConversation(id: string): Conversation | null {
  try {
    const row = db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
         FROM conversations c
         WHERE c.id = ? AND c.deleted_at IS NULL`,
      )
      .get(id) as ConversationRow | undefined;
    return row ? rowToConversation(row) : null;
  } catch (err) {
    log.error({ err, id }, "Failed to get conversation");
    throw new StoreError("Failed to get conversation", { cause: err });
  }
}

/** 重命名会话 */
export function renameConversation(id: string, title: string): boolean {
  try {
    const result = db
      .prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
      .run(title.trim() || "未命名", Date.now(), id);
    return result.changes > 0;
  } catch (err) {
    log.error({ err, id }, "Failed to rename conversation");
    throw new StoreError("Failed to rename conversation", { cause: err });
  }
}

/** 软删除会话 */
export function deleteConversation(id: string): boolean {
  try {
    const result = db
      .prepare("UPDATE conversations SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
      .run(Date.now(), Date.now(), id);
    return result.changes > 0;
  } catch (err) {
    log.error({ err, id }, "Failed to delete conversation");
    throw new StoreError("Failed to delete conversation", { cause: err });
  }
}

/** 读取会话消息(按时间正序;before 用于向前翻页) */
export function getMessages(conversationId: string, limit = 50, before?: number): ConversationMessage[] {
  try {
    const rows = db
      .prepare(
        `SELECT * FROM messages
         WHERE conversation_id = ? AND (? IS NULL OR created_at < ?)
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(conversationId, before ?? null, before ?? null, limit) as MessageRow[];
    return rows.reverse().map(rowToMessage);
  } catch (err) {
    log.error({ err, conversationId }, "Failed to get messages");
    throw new StoreError("Failed to get messages", { cause: err });
  }
}

/** 追加消息并触发全局历史上限裁剪 */
export function addConversationMessage(conversationId: string, message: NewMessage): ConversationMessage {
  const now = Date.now();
  const id = `msg_${now}_${randomSuffix()}`;
  try {
    const insert = db.transaction(() => {
      db.prepare(
        `INSERT INTO messages
          (id, conversation_id, role, content, query_type, doc_count, citations_json, degraded, model, latency_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        conversationId,
        message.role,
        message.content,
        message.queryType ?? null,
        message.docCount ?? null,
        message.citations ? JSON.stringify(message.citations) : null,
        message.degraded ? 1 : 0,
        message.model ?? null,
        message.latencyMs ?? null,
        now,
      );

      db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now, conversationId);

      const count = (db.prepare("SELECT COUNT(*) AS count FROM messages").get() as { count: number }).count;
      const excess = count - config.maxHistory;
      if (excess > 0) {
        db.prepare("DELETE FROM messages WHERE id IN (SELECT id FROM messages ORDER BY created_at ASC LIMIT ?)").run(
          excess,
        );
      }
    });
    insert();

    return {
      id,
      timestamp: now,
      role: message.role,
      content: message.content,
      ...(message.queryType ? { queryType: message.queryType } : {}),
      ...(message.docCount !== undefined ? { docCount: message.docCount } : {}),
      ...(message.citations ? { citations: message.citations } : {}),
      ...(message.degraded ? { degraded: true } : {}),
      ...(message.model ? { model: message.model } : {}),
      ...(message.latencyMs !== undefined ? { latencyMs: message.latencyMs } : {}),
    };
  } catch (err) {
    log.error({ err, conversationId }, "Failed to add conversation message");
    throw new StoreError("Failed to add conversation message", { cause: err });
  }
}

/**
 * 会话历史上下文(JSON 消息数组字符串)
 *
 * 仅取 user/assistant,最多 maxTurns 轮。
 */
export function getHistoryForConversation(conversationId: string, maxTurns = 3): string | undefined {
  try {
    const rows = db
      .prepare(
        `SELECT role, content FROM messages
         WHERE conversation_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(conversationId, maxTurns * 2) as Array<{ role: string; content: string }>;
    if (rows.length === 0) return undefined;
    return JSON.stringify(rows.reverse().map((row) => ({ role: row.role, content: row.content })));
  } catch (err) {
    log.error({ err, conversationId }, "Failed to build conversation history");
    throw new StoreError("Failed to build conversation history", { cause: err });
  }
}

// ========================================
// 兼容 CLI / TUI 的旧接口(固定 cli 会话)
// ========================================

/** 追加消息到 CLI 会话 */
export function addMessage(message: NewMessage): ConversationMessage {
  ensureConversation(DEFAULT_CONVERSATION_ID, DEFAULT_CONVERSATION_TITLE);
  return addConversationMessage(DEFAULT_CONVERSATION_ID, message);
}

/** 最近的对话消息(跨会话,供 /history 与启动摘要使用) */
export function getRecentHistory(limit = 100): ConversationMessage[] {
  try {
    const rows = db.prepare("SELECT * FROM messages ORDER BY created_at DESC LIMIT ?").all(limit) as MessageRow[];
    return rows.reverse().map(rowToMessage);
  } catch (err) {
    log.error({ err }, "Failed to retrieve conversation history");
    throw new StoreError("Failed to retrieve conversation history", { cause: err });
  }
}

/** CLI 会话的历史上下文 */
export function getHistoryForContext(maxTurns = 3): string | undefined {
  return getHistoryForConversation(DEFAULT_CONVERSATION_ID, maxTurns);
}

/** 清空所有会话与消息(CLI /clear 与旧 API) */
export function clearHistory(): void {
  try {
    db.transaction(() => {
      db.prepare("DELETE FROM messages").run();
      db.prepare("DELETE FROM conversations").run();
    })();
    log.info("Conversation history cleared");
  } catch (err) {
    log.error({ err }, "Failed to clear conversation history");
    throw new StoreError("Failed to clear conversation history", { cause: err });
  }
}
