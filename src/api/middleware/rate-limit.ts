/**
 * 速率限制中间件
 *
 * 基于内存滑动窗口实现简单的速率限制。
 * 企业部署应替换为 Redis 等分布式限流器。
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../../config.js";
import { ErrorCode, YijingError } from "../../errors.js";
import { createLogger } from "../../logger.js";

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
setInterval(cleanupExpired, 30_000);

function getClientIdentifier(req: FastifyRequest): string {
  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    (req.headers["x-real-ip"] as string) ||
    (req.socket?.remoteAddress as string) ||
    "unknown";
  return ip;
}

export async function rateLimitMiddleware(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const identifier = getClientIdentifier(req);
  const maxRequests = identifier.includes(":") ? config.rateLimitAuthMax : config.rateLimitMax;
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
