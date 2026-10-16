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

export const config = {
  // ── LLM ──
  openaiBaseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  llmModel: process.env.LLM_MODEL || "gpt-4o-mini",
  /** /deep 深度分析独立模型:结构化输出强制 tool_choice,部分 thinking 模型不支持 */
  deepModel: process.env.DEEP_MODEL || process.env.LLM_MODEL || "gpt-4o-mini",
  llmTemperature: parseFloat(process.env.LLM_TEMPERATURE || "0.3"),
  llmMaxRetries: parseInt(process.env.LLM_MAX_RETRIES || "3", 10),
  llmRetryBaseDelay: parseInt(process.env.LLM_RETRY_BASE_DELAY || "2000", 10),

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
