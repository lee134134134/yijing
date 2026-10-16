/**
 * 安全中间件
 *
 * 提供安全响应头（Helmet-like）。
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createLogger } from "../../logger.js";

const log = createLogger("api:middleware:security");

/** 危险字符模式（防止注入攻击） */
const INJECTION_PATTERNS = [
  /(\bunion\b.*\bselect\b)/i,
  /(\bselect\b.*\bfrom\b)/i,
  /(\bdrop\b.*\btable\b)/i,
  /(<script[^>]*>.*<\/script>)/i,
];

/**
 * 检测潜在注入攻击
 */
export function detectInjection(input: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(input));
}

/**
 * 清理用户输入中的潜在危险内容
 */
export function sanitizeInput(input: string): string {
  let cleaned = input.trim();
  cleaned = cleaned.replace(/<script[^>]*>.*?<\/script>/gi, "");
  if (cleaned.length > 10000) {
    cleaned = cleaned.slice(0, 10000);
    log.warn({ inputLength: cleaned.length }, "Input truncated for security");
  }
  return cleaned;
}

/**
 * 安全响应头中间件（Fastify 5 onRequest hook）
 */
export async function securityHeadersMiddleware(_req: FastifyRequest, reply: FastifyReply): Promise<void> {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Frame-Options", "DENY");
  reply.header("X-XSS-Protection", "1; mode=block");
  reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
  reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  reply.header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  reply.header("Pragma", "no-cache");
  reply.header("Expires", "0");
}

/**
 * 注册安全中间件到 Fastify 实例
 */
export async function registerSecurityMiddleware(server: FastifyInstance): Promise<void> {
  server.addHook("onRequest", securityHeadersMiddleware);
}
