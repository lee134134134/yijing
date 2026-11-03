/**
 * 速率限制中间件
 *
 * 基于内存滑动窗口实现简单的速率限制。
 * 企业部署应替换为 Redis 等分布式限流器。
 */

import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../../config.js";
import { ErrorCode, YijingError } from "../../errors.js";
import { createLogger } from "../../logger.js";
import { getApiKey, isValidApiKey } from "./auth.js";

const log = createLogger("api:middleware:rate-limit");

const WINDOW_MS = 60_000;

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

function cleanupExpired(): void {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (now - entry.windowStart > WINDOW_MS) {
      rateLimitStore.delete(key);
    }
  }
}
setInterval(cleanupExpired, 30_000).unref();

/**
 * 客户端标识
 *
 * 已认证请求按 API key 分桶(哈希后,避免 key 进日志);
 * 匿名请求按 IP 分桶。IP 由 Fastify 依据 trustProxy 解析,
 * 不再手工读取 X-Forwarded-For(可伪造)。
 */
function getClientIdentifier(req: FastifyRequest): string {
  if (isValidApiKey(req)) {
    const key = getApiKey(req) ?? "";
    const hash = createHash("sha256").update(key).digest("hex").slice(0, 16);
    return `key:${hash}`;
  }
  return `ip:${req.ip || "unknown"}`;
}

export async function rateLimitMiddleware(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const identifier = getClientIdentifier(req);
  const maxRequests = identifier.startsWith("key:") ? config.rateLimitAuthMax : config.rateLimitMax;
  const now = Date.now();
  const entry = rateLimitStore.get(identifier);

  if (entry && now - entry.windowStart < WINDOW_MS) {
    if (entry.count >= maxRequests) {
      log.warn({ identifier, count: entry.count, max: maxRequests }, "Rate limit exceeded");
      reply.code(429).send(
        new YijingError(ErrorCode.RATE_LIMITED, "Too many requests, please try again later.", {
          statusCode: 429,
          details: { retryAfter: Math.ceil((entry.windowStart + WINDOW_MS - now) / 1000) },
        }).toJSON(),
      );
      return;
    }
    entry.count++;
  } else {
    rateLimitStore.set(identifier, { count: 1, windowStart: now });
  }

  reply.header("X-RateLimit-Limit", String(maxRequests));
  const remaining = maxRequests - (entry?.count ?? 0);
  reply.header("X-RateLimit-Remaining", String(Math.max(0, remaining)));
}

export function clearRateLimitStore(): void {
  rateLimitStore.clear();
}
