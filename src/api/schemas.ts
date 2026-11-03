/**
 * OpenAPI / 请求校验共享 Schema
 *
 * 既用于 /docs 文档生成,也用于 Fastify 运行时校验。
 * 响应 Schema 必须列全字段:fast-json-stringify 会丢弃未声明字段。
 */

/** 统一错误响应 */
export const errorResponseSchema = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        details: { type: "object", additionalProperties: true },
      },
    },
  },
} as const;

/** POST /api/query 请求体 */
export const queryBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["query"],
  properties: {
    query: { type: "string", minLength: 1, maxLength: 2000 },
    stream: { type: "boolean" },
  },
} as const;

/** 引用条目(与 src/types.ts 的 Citation 对应) */
export const citationSchema = {
  type: "object",
  required: ["refId", "source", "domain", "snippet"],
  properties: {
    refId: { type: "string" },
    source: { type: "string" },
    h1: { type: "string" },
    h2: { type: "string" },
    h3: { type: "string" },
    lineRange: { type: "string" },
    domain: { type: "string" },
    snippet: { type: "string" },
    score: { type: "number" },
  },
} as const;

/** POST /api/query 响应(stream=false 时) */
export const queryResponseSchema = {
  type: "object",
  required: ["response", "queryType", "docCount", "elapsed", "citations"],
  properties: {
    response: { type: "string" },
    queryType: { type: "string" },
    docCount: { type: "integer" },
    elapsed: { type: "number" },
    citations: { type: "array", items: citationSchema },
  },
} as const;

/** POST /api/deep 请求体 */
export const deepBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["query"],
  properties: {
    query: { type: "string", minLength: 1, maxLength: 2000 },
  },
} as const;

/** POST /api/deep 响应 */
export const deepResponseSchema = {
  type: "object",
  required: ["conclusion", "reasoning", "references", "confidence", "elapsed"],
  properties: {
    conclusion: { type: "string" },
    reasoning: { type: "string" },
    references: {
      type: "array",
      items: {
        type: "object",
        required: ["source", "content", "domain"],
        properties: {
          source: { type: "string" },
          content: { type: "string" },
          domain: { type: "string" },
          refId: { type: "string" },
        },
      },
    },
    confidence: { type: "number" },
    suggestions: { type: "array", items: { type: "string" } },
    elapsed: { type: "number" },
  },
} as const;

/** GET /api/history 查询参数 */
export const historyQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "string", pattern: "^[0-9]+$" },
  },
} as const;

/** GET /api/history 响应 */
export const historyResponseSchema = {
  type: "object",
  required: ["history", "total"],
  properties: {
    history: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "timestamp", "role", "content"],
        properties: {
          id: { type: "string" },
          timestamp: { type: "number" },
          role: { type: "string" },
          content: { type: "string" },
          queryType: { type: "string" },
          docCount: { type: "integer" },
        },
      },
    },
    total: { type: "integer" },
  },
} as const;

/** GET /api/status 响应(允许扩展字段,避免新增健康信息被裁掉) */
export const statusResponseSchema = {
  type: "object",
  additionalProperties: true,
  required: ["docCount", "model", "collections", "version"],
  properties: {
    docCount: { type: "integer" },
    model: { type: "string" },
    collections: { type: "array", items: { type: "string" } },
    version: { type: "string" },
    embeddingModel: { type: "string" },
    chromaDbUrl: { type: "string" },
    queryRewrite: { type: "boolean" },
    maxContextTokens: { type: "integer" },
    chunkSize: { type: "integer" },
    chunkOverlap: { type: "integer" },
    llm: { type: "array", items: { type: "object", additionalProperties: true } },
    health: { type: "object", additionalProperties: true },
    index: { type: "object", additionalProperties: true },
  },
} as const;

/** GET /ready 响应 */
export const readyResponseSchema = {
  type: "object",
  required: ["ready", "checks"],
  properties: {
    ready: { type: "boolean" },
    checks: { type: "object", additionalProperties: true },
  },
} as const;
