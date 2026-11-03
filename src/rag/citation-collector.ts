/**
 * 请求级引用收集器
 *
 * 工具层是模块级单例(避免每次请求重建 Agent),但引用必须按请求隔离。
 * 用 AsyncLocalStorage 把收集器绑定到当前异步调用链:
 * - agenticRag / deepAnalysis 在请求入口创建
 * - 检索工具通过 getCitationCollector() 写入
 * - 请求结束读取 all,并发请求互不污染
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { Citation } from "../types.js";

export class CitationCollector {
  private readonly entries = new Map<string, Citation>();

  add(citation: Citation): void {
    if (!this.entries.has(citation.refId)) {
      this.entries.set(citation.refId, citation);
    }
  }

  addAll(citations: Citation[]): void {
    for (const citation of citations) this.add(citation);
  }

  get all(): Citation[] {
    return [...this.entries.values()];
  }

  get size(): number {
    return this.entries.size;
  }
}

const storage = new AsyncLocalStorage<CitationCollector>();

/**
 * 在独立收集器中执行一段异步逻辑
 *
 * 返回结果与本次执行期间收集到的全部引用。
 */
export async function collectWithCitations<T>(fn: () => Promise<T>): Promise<{ result: T; citations: Citation[] }> {
  const collector = new CitationCollector();
  const result = await storage.run(collector, fn);
  return { result, citations: collector.all };
}

/** 当前异步上下文中的收集器(非请求上下文返回 undefined) */
export function getCitationCollector(): CitationCollector | undefined {
  return storage.getStore();
}
