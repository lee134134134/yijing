import type { DocumentInterface } from "@langchain/core/documents";

/** 知识库文档元数据 */
export interface KnowledgeMetadata {
  /** 来源文件路径 */
  source: string;
  /** 所属知识域：人纪/天纪/命理/面相/养生/方剂/医案/文集 */
  domain: string;
  /** 一级标题 */
  h1?: string;
  /** 二级标题 */
  h2?: string;
  /** 三级标题 */
  h3?: string;
  /** 原始 Markdown 文件的行号范围 */
  lineRange?: string;
}

/** 带元数据的知识文档 */
export type KnowledgeDocument = DocumentInterface<KnowledgeMetadata>;

/** Agent 分析结果 */
export interface AnalysisResult {
  /** 分析结论 */
  conclusion: string;
  /** 推理过程 */
  reasoning: string;
  /** 引用的知识来源 */
  references: Array<{
    source: string;
    content: string;
    domain: string;
  }>;
  /** 置信度 0-1 */
  confidence: number;
  /** 建议的后续操作 */
  suggestions?: string[];
}

/** 查询类型 */
export type QueryType =
  | "tcm_diagnosis" // 中医诊断/辨证
  | "tcm_prescription" // 方剂咨询
  | "bazi_analysis" // 八字命理分析
  | "mianxiang_analysis" // 面相分析
  | "yijing_divination" // 易经占卜
  | "health_advice" // 养生建议
  | "general_knowledge" // 一般知识问答
  | "deep_analysis" // 深度分析
  | "unknown"; // 未识别

/** 普通查询结果 */
export interface QueryResult {
  response: string;
  queryType: QueryType;
  docCount: number;
}

/** 流式查询块 */
export interface StreamChunk {
  type: "text" | "meta" | "error" | "done";
  /** text: 生成的文本片段; meta: 元数据; error: 错误信息; done: 完成信号 */
  data: string | QueryResult | { error: string };
  /** 仅在 type='meta' 时存在 */
  queryType?: QueryType;
  docCount?: number;
  elapsed?: number;
}

/** API 请求体 */
export interface QueryRequest {
  query: string;
  stream?: boolean;
}

/** API 响应（非流式） */
export interface QueryResponse {
  response: string;
  queryType: QueryType;
  docCount: number;
  elapsed: number;
}

export interface DeepAnalysisResponse {
  conclusion: string;
  reasoning: string;
  references: Array<{ source: string; content: string; domain: string }>;
  confidence: number;
  suggestions?: string[];
  elapsed: number;
}

export interface StatusResponse {
  docCount: number;
  model: string;
  collections: string[];
  version: string;
  embeddingModel: string;
  chromaDbUrl: string;
  queryRewrite: boolean;
  maxContextTokens: number;
  chunkSize: number;
  chunkOverlap: number;
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}
