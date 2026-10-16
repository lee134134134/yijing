/**
 * withRetry 单元测试
 *
 * 覆盖:首次成功 / 失败后重试成功 / 重试耗尽抛 RetryError(attempts 与
 * lastError 保留) / maxRetries=0 边界 / 非 Error 拒绝值包装。
 * 退避 + 抖动用 fake timers 推进,测试无需真实等待。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { RetryError, withRetry } from "../utils/retry.js";

describe("withRetry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("首次成功:fn 只调用一次", async () => {
    const fn = vi.fn().mockResolvedValue("ok");

    await expect(withRetry(fn, { maxRetries: 3, baseDelay: 10 })).resolves.toBe("ok");

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("失败两次后成功:fn 调用 3 次(退避被计时器推进)", async () => {
    vi.useFakeTimers();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail-1"))
      .mockRejectedValueOnce(new Error("fail-2"))
      .mockResolvedValue("ok");

    const p = withRetry(fn, { maxRetries: 5, baseDelay: 100 });
    await vi.advanceTimersByTimeAsync(60_000);

    await expect(p).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("重试耗尽:抛 RetryError,attempts=maxRetries+1 且 lastError 保留", async () => {
    vi.useFakeTimers();
    const boom = new Error("boom");
    const fn = vi.fn().mockRejectedValue(boom);

    const p = withRetry(fn, { maxRetries: 2, baseDelay: 50 });
    const caught = p.catch((err: unknown) => err); // 立即附着,避免 unhandled rejection
    await vi.advanceTimersByTimeAsync(60_000);

    const err = await caught;
    expect(err).toBeInstanceOf(RetryError);
    expect((err as RetryError).attempts).toBe(3);
    expect((err as RetryError).lastError).toBe(boom);
    expect((err as RetryError).message).toContain("boom");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("maxRetries=0:立即抛错且只调用一次(无退避等待)", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("x"));

    await expect(withRetry(fn, { maxRetries: 0, baseDelay: 10 })).rejects.toThrow(RetryError);

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("非 Error 拒绝值被包装为 Error 后重试成功", async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValueOnce("string failure").mockResolvedValue("ok");

    const p = withRetry(fn, { maxRetries: 1, baseDelay: 10 });
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(p).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
