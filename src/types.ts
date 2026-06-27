import { DocumentInterface } from "@langchain/core/documents";

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

/** 知识域枚举 */
export const KNOWLEDGE_DOMAINS = {
  HUANGDI_NEIJING: "黄帝内经",
  SHANGHAN_LUN: "伤寒论",
  JINGUI_YAOLUE: "金匮要略",
  SHENNONG_BENCAO: "神农本草经",
  ZHENJIU: "针灸",
  TIANJI: "天纪",
  MINGLI_BAZI: "命理八字",
  MIANXIANG: "面相学",
  ZHONGYI_LINCHUANG: "中医临床",
  YANGSHENG: "养生功法",
  FANGJI: "方剂",
  YIAN: "医案",
  YINSHI: "阴实理论",
  WENJI: "文集",
} as const;

export type KnowledgeDomain =
  (typeof KNOWLEDGE_DOMAINS)[keyof typeof KNOWLEDGE_DOMAINS];

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

/** LangGraph Agent State */
export interface AgentState {
  /** 用户原始输入 */
  input: string;
  /** 对话历史摘要 */
  chatHistory?: string;
  /** 分类的查询类型 */
  queryType?: QueryType;
  /** 检索到的知识文档 */
  retrievedDocs?: KnowledgeDocument[];
  /** 分析结果 */
  analysis?: AnalysisResult;
  /** 最终回复 */
  response?: string;
  /** 是否需要追问 */
  needsClarification?: boolean;
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
