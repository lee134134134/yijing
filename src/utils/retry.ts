/**
 * 重试工具函数
 *
 * 提供指数退避重试逻辑，用于保护外部依赖调用（LLM、ChromaDB 等）。
 */

import { createLogger } from "../logger.js";

const log = createLogger("utils:retry");

/** 重试配置 */
export interface RetryOptions {
  maxRetries: number;
  baseDelay: number;
  maxDelay?: number;
  retries?: number; // 已重试次数（内部使用）
}

/** 重试错误 */
export class RetryError extends Error {
  public readonly attempts: number;
  public readonly lastError: Error;

  constructor(message: string, attempts: number, lastError: Error) {
    super(message);
    this.name = "RetryError";
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

/**
 * 指数退避重试
 *
 * @param fn - 要执行的异步函数
 * @param options - 重试配置
 * @returns 函数执行结果
 * @throws RetryError - 所有重试都失败时抛出
 */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  const { maxRetries, baseDelay, maxDelay = 30_000 } = options;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      log.warn({ attempt, error: lastError.message }, `Retry attempt ${attempt} failed`);

      if (attempt < maxRetries) {
        // 指数退避 + 随机抖动
        const delay = Math.min(baseDelay * 2 ** attempt, maxDelay);
        const jitter = delay * 0.1 * Math.random();
        const totalDelay = delay + jitter;
        await sleep(totalDelay);
      }
    }
  }

  throw new RetryError(
    `Operation failed after ${maxRetries + 1} attempts: ${lastError?.message}`,
    maxRetries + 1,
    lastError ?? new Error("Unknown error"),
  );
}

/** 睡眠工具 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 创建带超时的 Promise
 *
 * @param promise - 原始 Promise
 * @param timeoutMs - 超时时间（毫秒）
 * @param label - 超时错误信息中的标识
 * @returns 带超时控制的 Promise
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string = "operation"): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }),
  ]);
}
