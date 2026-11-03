/**
 * API 密钥认证中间件
 *
 * 企业级部署必须启用 API 密钥认证。
 * 通过 X-API-Key 或 Authorization: Bearer <key> 传递。
 * 未配置 API_KEY 时，开发模式允许无密钥访问（仅限本地）。
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../../config.js";
import { ErrorCode, YijingError } from "../../errors.js";
import { createLogger } from "../../logger.js";

const log = createLogger("api:middleware:auth");

/** API 密钥白名单（从 config.apiKeys 读取，支持多个密钥） */
const apiKeys = new Set<string>();
let authEnabled = false;

/**
 * 初始化认证模块
 * - 密钥来源:仅 API_KEYS(不再回退 LLM 供应商密钥)
 * - 支持逗号分隔的多个密钥;未配置时禁用认证(仅回环地址允许)
 */
export function initAuth(): void {
  for (const key of config.apiKeys) {
    apiKeys.add(key);
  }
  authEnabled = apiKeys.size > 0;
  if (authEnabled) {
    log.info({ keyCount: apiKeys.size }, "API key authentication enabled");
  } else {
    log.warn("No API keys configured - auth disabled (loopback only)");
  }
}

/** 从请求头提取 API key(X-API-Key 优先,其次 Bearer) */
export function getApiKey(req: FastifyRequest): string | undefined {
  const headerKey = req.headers["x-api-key"];
  if (typeof headerKey === "string" && headerKey.length > 0) return headerKey;
  const authorization = req.headers.authorization;
  if (authorization?.startsWith("Bearer ")) return authorization.slice(7);
  return undefined;
}

/** 请求是否携带了有效密钥(供限流分桶复用,不发送响应) */
export function isValidApiKey(req: FastifyRequest): boolean {
  if (!authEnabled) return false;
  const key = getApiKey(req);
  return key !== undefined && apiKeys.has(key);
}

/** 验证请求是否已认证 */
export function authenticate(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!authEnabled) return true; // 单机回环模式放行

  if (isValidApiKey(req)) return true;

  log.warn({ requestId: req.id }, "Authentication failed");
  reply
    .code(401)
    .send(new YijingError(ErrorCode.UNAUTHORIZED, "Invalid or missing API key", { statusCode: 401 }).toJSON());
  return false;
}

/** 是否启用认证 */
export function isAuthEnabled(): boolean {
  return authEnabled;
}
