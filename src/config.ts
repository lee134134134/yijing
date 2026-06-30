import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

export const config = {
  /** OpenAI 兼容 API 的 Base URL */
  openaiBaseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",

  /** API Key */
  openaiApiKey: process.env.OPENAI_API_KEY || "",

  /** Embedding 模型名称 */
  embeddingModel: process.env.EMBEDDING_MODEL || "text-embedding-3-small",

  /** 对话/分析模型名称 */
  llmModel: process.env.LLM_MODEL || "gpt-4o-mini",

  /** LLM 温度 */
  llmTemperature: parseFloat(process.env.LLM_TEMPERATURE || "0.3"),

  /** 数据持久化目录 */
  dataDir: path.resolve(projectRoot, "./data"),

  /** 集合名称 */
  chromaCollectionName: process.env.CHROMA_COLLECTION_NAME || "yijing_knowledge",

  /** 知识库 Markdown 目录（相对于项目根） */
  knowledgeDir: path.resolve(projectRoot, process.env.KNOWLEDGE_DIR || "./memory"),

  /** 每次检索返回的文档数 */
  retrievalTopK: parseInt(process.env.RETRIEVAL_TOP_K || "5", 10),

  /** 文本分块大小（字符数） */
  chunkSize: parseInt(process.env.CHUNK_SIZE || "800", 10),

  /** 分块重叠（字符数） */
  chunkOverlap: parseInt(process.env.CHUNK_OVERLAP || "150", 10),

  /** 启用混合搜索（n-gram + BM25） */
  enableHybridSearch: process.env.ENABLE_HYBRID_SEARCH !== "false",

  /** RRF 融合参数 k（越大则排序越均匀） */
  hybridSearchRrfK: parseInt(process.env.HYBRID_SEARCH_RRF_K || "60", 10),

  /** 启用 LLM 重排序（额外 LLM 调用，默认关闭） */
  enableReranking: process.env.ENABLE_RERANKING === "true",

  /** LLM 调用最大重试次数 */
  llmMaxRetries: parseInt(process.env.LLM_MAX_RETRIES || "3", 10),

  /** 重试基础延迟（ms） */
  llmRetryBaseDelay: parseInt(process.env.LLM_RETRY_BASE_DELAY || "2000", 10),

  /** 对话历史最大保留条数 */
  maxHistory: parseInt(process.env.MAX_HISTORY || "200", 10),
} as const;

export type Config = typeof config;
