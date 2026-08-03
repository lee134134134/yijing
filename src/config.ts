import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

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
  embeddingModel: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
  embeddingDimension: parseInt(process.env.EMBEDDING_DIMENSION || "1536", 10),
  /** 独立的 Embedding API 地址（默认复用 OPENAI_BASE_URL） */
  embeddingBaseUrl: process.env.EMBEDDING_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  /** 独立的 Embedding API Key（默认复用 OPENAI_API_KEY） */
  embeddingApiKey: process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || "",

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

  // ── 日志 ──
  logLevel: process.env.LOG_LEVEL || "info",
  logFile: process.env.LOG_FILE !== "false",
} as const;

export type Config = typeof config;
