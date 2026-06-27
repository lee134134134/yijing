import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

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
  chromaCollectionName:
    process.env.CHROMA_COLLECTION_NAME || "yijing_knowledge",

  /** 知识库 Markdown 目录（相对于项目根） */
  knowledgeDir: path.resolve(
    projectRoot,
    process.env.KNOWLEDGE_DIR || "./memory"
  ),

  /** 每次检索返回的文档数 */
  retrievalTopK: parseInt(process.env.RETRIEVAL_TOP_K || "5", 10),

  /** 文本分块大小（字符数） */
  chunkSize: parseInt(process.env.CHUNK_SIZE || "800", 10),

  /** 分块重叠（字符数） */
  chunkOverlap: parseInt(process.env.CHUNK_OVERLAP || "150", 10),
} as const;

export type Config = typeof config;
