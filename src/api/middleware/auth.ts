/**
 * API 密钥认证中间件
 *
 * 企业级部署必须启用 API 密钥认证。
 * 通过 X-API-Key 或 Authorization: Bearer <key> 传递。
 * 未配置 API_KEY 时，开发模式允许无密钥访问（仅限本地）。
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../../config.js";
import { ValidationError } from "../../errors.js";
import { createLogger } from "../../logger.js";

const log = createLogger("api:middleware:auth");

/** API 密钥白名单（从 config.apiKeys 读取，支持多个密钥） */
const apiKeys = new Set<string>();
let authEnabled = false;

/**
 * 初始化认证模块
 * - 密钥来源:API_KEYS 环境变量,未设置时回退 OPENAI_API_KEY
 * - 支持逗号分隔的多个密钥;两者均缺失时禁用认证(开发模式)
 */
export function initAuth(): void {
  for (const key of config.apiKeys) {
    apiKeys.add(key);
  }
  authEnabled = apiKeys.size > 0;
  if (authEnabled) {
    log.info({ keyCount: apiKeys.size }, "API key authentication enabled");
  } else {
    log.warn("No API keys configured - auth disabled (dev mode only)");
  }
}

/** 验证请求是否已认证 */
export function authenticate(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!authEnabled) return true; // 开发模式放行

  const apiKey =
    (req.headers["x-api-key"] as string) ||
    (req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : undefined);

  if (!apiKey || !apiKeys.has(apiKey)) {
    log.warn({ requestId: req.id }, "Authentication failed");
    reply.code(401).send(new ValidationError("Invalid or missing API key").toJSON());
    return false;
  }

  return true;
}

/** 是否启用认证 */
export function isAuthEnabled(): boolean {
  return authEnabled;
}
