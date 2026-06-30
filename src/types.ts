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
  | "unknown"; // 未识别
