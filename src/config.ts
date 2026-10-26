import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

/**
 * Embedding 提供方(模块级计算,供 config 内默认值引用):
 * - local(默认):本地 transformers 模型,dim 384,离线可用
 * - api:OpenAI 兼容 embeddings API,dim 1536
 * 切换 provider 必须重新 `npm run ingest`(ChromaDB 集合维度需一致)
 */
const embeddingProvider: "local" | "api" = process.env.EMBEDDING_PROVIDER === "api" ? "api" : "local";

// ── LLM Provider 配置解析辅助 ──
/** 配置解析问题:不在加载时抛错,由 config-validation 启动时统一 fail fast */
const llmConfigIssues: string[] = [];

/** 解析 JSON 对象环境变量(如 extra headers / model kwargs) */
function parseJsonObject(raw: string | undefined, name: string): Record<string, unknown> {
  if (!raw?.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    llmConfigIssues.push(`${name} must be a JSON object`);
  } catch {
    llmConfigIssues.push(`${name} is not valid JSON`);
  }
  return {};
}

/** 只保留字符串值,避免 number/boolean 被悄悄塞进请求头 */
function toStringRecord(raw: Record<string, unknown>, name: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") out[key] = value;
    else llmConfigIssues.push(`${name}.${key} must be a string`);
  }
  return out;
}

function optionalFloat(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw?.trim()) return undefined;
  const parsed = Number.parseFloat(raw);
  if (Number.isNaN(parsed)) {
    llmConfigIssues.push(`${name} must be a number`);
    return undefined;
  }
  return parsed;
}

function optionalInt(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw?.trim()) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    llmConfigIssues.push(`${name} must be an integer`);
    return undefined;
  }
  return parsed;
}

/** 角色级配置:LLM_MAIN_* / LLM_DEEP_* / LLM_CLASSIFY_* / LLM_REWRITE_* */
function buildRoleConfig(prefix: string) {
  return {
    provider: process.env[`LLM_${prefix}_PROVIDER`] || "",
    model: process.env[`LLM_${prefix}_MODEL`] || "",
    apiKey: process.env[`LLM_${prefix}_API_KEY`] || "",
    baseUrl: process.env[`LLM_${prefix}_BASE_URL`] || "",
    temperature: optionalFloat(`LLM_${prefix}_TEMPERATURE`),
    maxTokens: optionalInt(`LLM_${prefix}_MAX_TOKENS`),
    headers: toStringRecord(
      parseJsonObject(process.env[`LLM_${prefix}_EXTRA_HEADERS`], `LLM_${prefix}_EXTRA_HEADERS`),
      `LLM_${prefix}_EXTRA_HEADERS`,
    ),
    modelKwargs: parseJsonObject(process.env[`LLM_${prefix}_MODEL_KWARGS`], `LLM_${prefix}_MODEL_KWARGS`),
  };
}

function parseDeepJsonMode(): "auto" | "on" | "off" {
  const raw = process.env.LLM_DEEP_JSON_MODE?.trim().toLowerCase();
  if (!raw || raw === "auto") return "auto";
  if (raw === "on" || raw === "off") return raw;
  llmConfigIssues.push(`LLM_DEEP_JSON_MODE must be auto/on/off, got "${raw}"`);
  return "auto";
}

/**
 * 各 provider 的 key 映射
 *
 * 优先级:LLM_PROVIDER_KEYS 的 JSON 自定义项 → 下面的专属环境变量。
 * 统一在 config.ts 读取,避免 llm 模块散落 process.env(项目规范)。
 */
const llmProviderKeys: Record<string, string> = toStringRecord(
  parseJsonObject(process.env.LLM_PROVIDER_KEYS, "LLM_PROVIDER_KEYS"),
  "LLM_PROVIDER_KEYS",
);
const normalizedProviderKeys: Record<string, string> = {};
for (const [providerId, apiKey] of Object.entries(llmProviderKeys)) {
  normalizedProviderKeys[providerId.trim().toLowerCase()] = apiKey;
}
const wellKnownProviderKeys: Array<[string, string | undefined]> = [
  ["openai", process.env.OPENAI_API_KEY],
  ["openrouter", process.env.OPENROUTER_API_KEY],
  ["deepseek", process.env.DEEPSEEK_API_KEY],
  ["moonshot", process.env.MOONSHOT_API_KEY],
  ["qwen", process.env.DASHSCOPE_API_KEY],
  ["zhipu", process.env.ZHIPU_API_KEY],
  ["siliconflow", process.env.SILICONFLOW_API_KEY],
  ["groq", process.env.GROQ_API_KEY],
  ["opencode", process.env.OPENCODE_API_KEY],
];
for (const [providerId, apiKey] of wellKnownProviderKeys) {
  if (apiKey) normalizedProviderKeys[providerId] = apiKey;
}

export const config = {
  // ── LLM ──
  openaiBaseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  llmModel: process.env.LLM_MODEL || "gpt-4o-mini",
  /** /deep 深度分析独立模型:结构化输出强制 tool_choice,部分 thinking 模型不支持 */
  deepModel: process.env.LLM_DEEP_MODEL || process.env.DEEP_MODEL || process.env.LLM_MODEL || "gpt-4o-mini",
  llmTemperature: parseFloat(process.env.LLM_TEMPERATURE || "0.3"),
  llmMaxRetries: parseInt(process.env.LLM_MAX_RETRIES || "3", 10),
  llmRetryBaseDelay: parseInt(process.env.LLM_RETRY_BASE_DELAY || "2000", 10),
  /** 单次 LLM 请求超时(ms);0 交给 SDK 默认 */
  llmTimeoutMs: parseInt(process.env.LLM_TIMEOUT_MS || "120000", 10),

  // ── LLM Provider(第三方大模型接入) ──
  /** 全局默认 provider(openai/openrouter/deepseek/…/custom);空则按 OPENAI_BASE_URL 自动识别 */
  llmProvider: process.env.LLM_PROVIDER || "",
  /** 全局 base URL 覆盖(优先级高于 provider 预设;旧 OPENAI_BASE_URL 仍兼容) */
  llmBaseUrl: process.env.LLM_BASE_URL || "",
  /** 全局 API Key(优先级低于 provider 专属 key) */
  llmApiKey: process.env.LLM_API_KEY || "",
  /** provider id → API Key;支持 LLM_PROVIDER_KEYS JSON 与各厂商专属变量 */
  llmProviderKeys: normalizedProviderKeys,
  /** 额外请求头(JSON),如 OpenRouter 的 HTTP-Referer / X-Title */
  llmExtraHeaders: toStringRecord(
    parseJsonObject(process.env.LLM_EXTRA_HEADERS, "LLM_EXTRA_HEADERS"),
    "LLM_EXTRA_HEADERS",
  ),
  /** 角色级覆盖:main/deep/classify/rewrite 可分别路由到不同 provider */
  llmRoles: {
    main: buildRoleConfig("MAIN"),
    deep: { ...buildRoleConfig("DEEP"), model: process.env.LLM_DEEP_MODEL || process.env.DEEP_MODEL || "" },
    classify: buildRoleConfig("CLASSIFY"),
    rewrite: buildRoleConfig("REWRITE"),
  },
  /** deep 角色 JSON 输出策略:auto=按 provider 能力,on=强制,off=关闭 */
  deepJsonMode: parseDeepJsonMode(),
  /** 外挂 provider 注册文件(JSON) */
  llmProvidersFile: process.env.LLM_PROVIDERS_FILE ? path.resolve(projectRoot, process.env.LLM_PROVIDERS_FILE) : "",
  /** 配置解析问题(启动校验汇总) */
  llmConfigIssues,

  // ── Agent ──
  /** DeepAgent 最大迭代轮数(控成本) */
  deepAgentMaxIterations: parseInt(process.env.DEEP_AGENT_MAX_ITERATIONS || "25", 10),
  /** 是否启用 todoListMiddleware(任务规划中间件) */
  enableTodoPlanning: process.env.ENABLE_TODO_PLANNING !== "false",

  // ── Embedding ──
  /**
   * Embedding 提供方:
   * - local(默认):本地 transformers 模型,dim 384,离线可用
   * - api:OpenAI 兼容 embeddings API,dim 1536
   * 切换 provider 必须重新 `npm run ingest`(ChromaDB 集合维度需一致)
   */
  embeddingProvider,
  embeddingModel:
    process.env.EMBEDDING_MODEL || (embeddingProvider === "api" ? "text-embedding-3-small" : "Xenova/all-MiniLM-L6-v2"),
  /** Embedding 向量维度(local=384,api=1536;仅作信息展示与校验,实际维度由模型/API 决定) */
  embeddingDimension: parseInt(process.env.EMBEDDING_DIMENSION || (embeddingProvider === "api" ? "1536" : "384"), 10),
  /** 独立的 Embedding API 地址（默认复用 OPENAI_BASE_URL） */
  embeddingBaseUrl: process.env.EMBEDDING_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  /** 独立的 Embedding API Key（默认复用 OPENAI_API_KEY） */
  embeddingApiKey: process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || "",
  /** 本地 Embedding 模型缓存目录（Docker 构建期预下载,避免运行时联网拉模型） */
  embeddingCacheDir: process.env.EMBEDDING_CACHE_DIR || path.resolve(projectRoot, "./data/models"),
  /** HuggingFace 镜像源（huggingface.co 访问受阻时切换,如 https://hf-mirror.com/） */
  hfMirror: process.env.HF_MIRROR || "https://hf-mirror.com/",

  // ── 向量存储 (ChromaDB) ──
  chromaDbUrl: process.env.CHROMA_DB_URL || "http://127.0.0.1:8000",
  chromaCollectionName: process.env.CHROMA_COLLECTION_NAME || "yijing_knowledge",

  // ── 检索 ──
  retrievalTopK: parseInt(process.env.RETRIEVAL_TOP_K || "5", 10),
  enableReranking: process.env.ENABLE_RERANKING === "true",

  // ── 查询重写 ──
  enableQueryRewrite: process.env.ENABLE_QUERY_REWRITE !== "false",
  rewriteNumQueries: parseInt(process.env.REWRITE_NUM_QUERIES || "3", 10),

  // ── 上下文窗口 ──
  maxContextTokens: parseInt(process.env.MAX_CONTEXT_TOKENS || "8192", 10),

  // ── 文本分块 ──
  chunkSize: parseInt(process.env.CHUNK_SIZE || "800", 10),
  chunkOverlap: parseInt(process.env.CHUNK_OVERLAP || "150", 10),

  // ── 知识库 ──
  knowledgeDir: path.resolve(projectRoot, process.env.KNOWLEDGE_DIR || "./memory"),

  // ── 对话 ──
  maxHistory: parseInt(process.env.MAX_HISTORY || "200", 10),

  // ── SQLite ──
  sqlitePath: process.env.SQLITE_PATH || path.resolve(projectRoot, "./data/yijing.db"),

  dataDir: path.resolve(projectRoot, "./data"),

  // ── API Server ──
  apiPort: parseInt(process.env.API_PORT || "3001", 10),
  apiHost: process.env.API_HOST || "0.0.0.0",
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
  /** 最大请求体大小（字节），默认 10MB */
  maxBodySize: parseInt(process.env.MAX_BODY_SIZE || "10485760", 10),
  /** 请求ID头名称 */
  requestIdHeader: process.env.REQUEST_ID_HEADER || "x-request-id",

  // ── 安全 ──
  /**
   * API 密钥白名单(逗号分隔)。为空时回退 OPENAI_API_KEY。
   * 两者都未配置时认证禁用(仅限本地开发模式)。
   */
  apiKeys: (process.env.API_KEYS || process.env.OPENAI_API_KEY || "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0),
  /** 限流:未认证客户端每分钟请求数 */
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || "100", 10),
  /** 限流:已认证客户端每分钟请求数 */
  rateLimitAuthMax: parseInt(process.env.RATE_LIMIT_AUTH_MAX || "1000", 10),

  /** TUI 模式开关:无参数且 stdout 为 TTY 时启动终端界面 */
  tuiMode: process.env.TUI === "true",

  // ── 日志 ──
  logLevel: process.env.LOG_LEVEL || "info",
  logFile: process.env.LOG_FILE !== "false",
} as const;

export type Config = typeof config;
