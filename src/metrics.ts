/**
 * Prometheus 指标
 *
 * - HTTP 请求数/延迟(按 method/route/status)
 * - 查询数/降级数
 * - 单次检索返回文档数
 *
 * GET /metrics 暴露;单机自用可直接 curl,不需要额外 exporter。
 */

import client from "prom-client";

export const registry = new client.Registry();

client.collectDefaultMetrics({ register: registry, prefix: "yijing_" });

export const httpRequestsTotal = new client.Counter({
  name: "yijing_http_requests_total",
  help: "HTTP requests by method, route and status",
  labelNames: ["method", "route", "status"] as const,
  registers: [registry],
});

export const httpRequestDuration = new client.Histogram({
  name: "yijing_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60],
  registers: [registry],
});

export const queriesTotal = new client.Counter({
  name: "yijing_queries_total",
  help: "Knowledge base queries",
  labelNames: ["degraded"] as const,
  registers: [registry],
});

export const queryDuration = new client.Histogram({
  name: "yijing_query_duration_seconds",
  help: "End-to-end query duration (including LLM)",
  labelNames: ["degraded"] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10, 20, 30, 60, 120],
  registers: [registry],
});

export const retrievalDocs = new client.Histogram({
  name: "yijing_retrieval_documents",
  help: "Number of unique documents returned per query",
  buckets: [0, 1, 2, 3, 5, 8, 13, 21],
  registers: [registry],
});

/** Prometheus 文本格式 */
export function metricsText(): Promise<string> {
  return registry.metrics();
}

/** Prometheus content type */
export const metricsContentType = registry.contentType;
