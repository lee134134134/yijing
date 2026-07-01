/**
 * 结构化日志系统
 *
 * 基于 pino，提供统一的日志入口，支持：
 * - 多级日志 (fatal/error/warn/info/debug/trace)
 * - JSON 输出（生产）/ 美化输出（开发）
 * - 请求追踪 (requestId)
 * - 模块级上下文
 */

import fs from "node:fs";
import path from "node:path";
import pino from "pino";
import { config } from "./config.js";

// 确保日志目录存在
const LOG_DIR = path.resolve(process.cwd(), "logs");
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

const targets: pino.TransportTargetOptions<Record<string, unknown>>[] = [];

// 控制台输出（开发模式用 pino-pretty，生产用 JSON）
if (process.env.NODE_ENV !== "production" || process.stdout.isTTY) {
  // pino-pretty in dev
  targets.push({
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:standard",
      ignore: "pid,hostname",
      messageFormat: "{if module}[{module}]{end} {msg}",
    },
    level: config.logLevel || "info",
  });
} else {
  targets.push({
    target: "pino/file",
    options: { destination: 1 }, // stdout
    level: config.logLevel || "info",
  });
}

// 文件输出（始终记录到文件）
if (config.logFile !== false) {
  ensureLogDir();
  const logFile = path.join(LOG_DIR, "app.log");
  targets.push({
    target: "pino/file",
    options: { destination: logFile, mkdir: true },
    level: "trace",
  });

  // 独立的错误日志
  const errLogFile = path.join(LOG_DIR, "error.log");
  targets.push({
    target: "pino/file",
    options: { destination: errLogFile, mkdir: true },
    level: "warn",
  });
}

const transport = pino.transport({ targets });

/** 根 Logger */
export const rootLogger = pino(
  {
    level: config.logLevel || "info",
    redact: {
      paths: ["apiKey", "OPENAI_API_KEY", "req.headers.authorization"],
      censor: "[REDACTED]",
    },
  },
  transport,
);

/**
 * 创建带模块上下文的子 Logger
 *
 * @example
 * const log = createLogger('vectorstore');
 * log.info('ChromaDB connected');
 * log.error({ err, dbName }, 'Query failed');
 */
export function createLogger(module: string): pino.Logger {
  return rootLogger.child({ module });
}

/**
 * 请求级别的日志上下文
 * 在 API 入口创建，贯穿整个请求周期
 */
export interface RequestContext {
  requestId: string;
  method: string;
  url: string;
  startTime: number;
}

/**
 * 创建请求上下文
 */
export function createRequestContext(method: string, url: string): RequestContext {
  return {
    requestId: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    method,
    url,
    startTime: Date.now(),
  };
}

/**
 * 记录请求完成日志
 */
export function logRequestComplete(ctx: RequestContext, statusCode: number, extra?: Record<string, unknown>) {
  const elapsed = Date.now() - ctx.startTime;
  rootLogger.info(
    {
      requestId: ctx.requestId,
      method: ctx.method,
      url: ctx.url,
      statusCode,
      elapsed,
      ...extra,
    },
    `[${ctx.requestId}] ${ctx.method} ${ctx.url} → ${statusCode} (${elapsed}ms)`,
  );
}

export default rootLogger;
