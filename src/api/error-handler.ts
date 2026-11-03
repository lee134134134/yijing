/**
 * API 统一错误响应
 *
 * 目标:
 * - 所有错误都返回 { error: { code, message, details? } },不把堆栈/内部细节透出
 * - Fastify 的 Schema 校验错误(4xx)映射为 INVALID_INPUT,而不是 500
 * - 路由插件与全局 handler 共用同一份逻辑,避免两套格式
 */

import type { FastifyInstance, FastifyReply } from "fastify";
import { ErrorCode, YijingError } from "../errors.js";
import { createLogger } from "../logger.js";

const log = createLogger("api:error");

interface FastifyErrorLike {
  statusCode?: number;
  code?: string;
  message?: string;
  validation?: unknown;
}

/** 把任意异常转换为统一错误响应 */
export function sendError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof YijingError) {
    if (err.statusCode >= 500) {
      log.error({ err, code: err.code }, "Request failed");
    } else {
      log.warn({ err, code: err.code }, "Request rejected");
    }
    return reply.status(err.statusCode).send(err.toJSON());
  }

  const candidate = (err ?? {}) as FastifyErrorLike;
  const statusCode = typeof candidate.statusCode === "number" ? candidate.statusCode : 500;

  if (candidate.validation || (statusCode >= 400 && statusCode < 500)) {
    // Schema 校验 / JSON 解析 / 请求体过大:消息本身是安全的,可以返回
    const code = statusCode === 413 ? ErrorCode.INVALID_INPUT : ErrorCode.INVALID_INPUT;
    return reply.status(statusCode).send(
      new YijingError(code, candidate.message || "Invalid request", {
        statusCode,
        ...(candidate.validation ? { details: { validation: candidate.validation } } : {}),
      }).toJSON(),
    );
  }

  log.error({ err }, "Unexpected error");
  return reply.status(500).send(new YijingError(ErrorCode.INTERNAL, "Internal server error").toJSON());
}

/** 注册全局错误处理 */
export function registerErrorHandler(server: FastifyInstance): void {
  server.setErrorHandler((err, _req, reply) => sendError(reply, err));
}
