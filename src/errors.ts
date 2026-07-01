/**
 * 错误分类体系
 *
 * 所有系统错误继承自 YijingError，支持：
 * - 错误码（便于 API 返回和前端处理）
 * - 内部上下文（不暴露给用户）
 * - 用户友好消息
 */

/** 错误码枚举 */
export enum ErrorCode {
  // ── 通用 (1xxx) ──
  UNKNOWN = "UNKNOWN",
  INTERNAL = "INTERNAL_ERROR",
  CONFIG_ERROR = "CONFIG_ERROR",

  // ── 检索 (2xxx) ──
  RETRIEVAL_FAILED = "RETRIEVAL_FAILED",
  VECTOR_STORE_UNAVAILABLE = "VECTOR_STORE_UNAVAILABLE",
  EMBEDDING_FAILED = "EMBEDDING_FAILED",
  NO_RESULTS = "NO_RESULTS",

  // ── LLM (3xxx) ──
  LLM_UNAVAILABLE = "LLM_UNAVAILABLE",
  LLM_TIMEOUT = "LLM_TIMEOUT",
  LLM_RATE_LIMITED = "LLM_RATE_LIMITED",
  LLM_INVALID_RESPONSE = "LLM_INVALID_RESPONSE",

  // ── 存储 (4xxx) ──
  STORE_UNAVAILABLE = "STORE_UNAVAILABLE",
  HISTORY_NOT_FOUND = "HISTORY_NOT_FOUND",

  // ── API (5xxx) ──
  INVALID_INPUT = "INVALID_INPUT",
  RATE_LIMITED = "RATE_LIMITED",
  NOT_FOUND = "NOT_FOUND",

  // ── 数据迁移 (6xxx) ──
  MIGRATION_FAILED = "MIGRATION_FAILED",
  NO_DATA_TO_MIGRATE = "NO_DATA_TO_MIGRATE",
}

/** 基础错误类 */
export class YijingError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    options?: {
      statusCode?: number;
      details?: Record<string, unknown>;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = "YijingError";
    this.code = code;
    this.statusCode = options?.statusCode ?? 500;
    this.details = options?.details;
    this.cause = options?.cause;
  }

  /** 转 JSON（给 API 返回用） */
  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

/** 检索相关错误 */
export class RetrievalError extends YijingError {
  constructor(message: string, options?: { details?: Record<string, unknown>; cause?: unknown }) {
    super(ErrorCode.RETRIEVAL_FAILED, message, { statusCode: 500, ...options });
    this.name = "RetrievalError";
  }
}

/** LLM 相关错误 */
export class LLMError extends YijingError {
  constructor(code: ErrorCode, message: string, options?: { details?: Record<string, unknown>; cause?: unknown }) {
    super(code, message, { statusCode: 502, ...options });
    this.name = "LLMError";
  }
}

/** 存储相关错误 */
export class StoreError extends YijingError {
  constructor(message: string, options?: { details?: Record<string, unknown>; cause?: unknown }) {
    super(ErrorCode.STORE_UNAVAILABLE, message, { statusCode: 500, ...options });
    this.name = "StoreError";
  }
}

/** 输入验证错误 */
export class ValidationError extends YijingError {
  constructor(message: string, options?: { details?: Record<string, unknown> }) {
    super(ErrorCode.INVALID_INPUT, message, { statusCode: 400, ...options });
    this.name = "ValidationError";
  }
}
