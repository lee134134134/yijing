import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { PromptTemplate } from "@langchain/core/prompts";
import { createChatModel } from "../llm/factory.js";
import type { LlmRole } from "../llm/types.js";
import { createLogger } from "../logger.js";
import type { QueryType } from "../types.js";

const log = createLogger("rag:chain");

/** 统一 Chat 模型工厂 */
export interface ChatModelOptions {
  /** 角色路由:main/deep/classify/rewrite,默认 main */
  role?: LlmRole;
  /** 覆盖模型名(如 /deep 的 deepModel) */
  model?: string;
  /** 覆盖温度 */
  temperature?: number;
  /** 透传底层模型参数(如 response_format、thinking 开关) */
  modelKwargs?: Record<string, unknown>;
  /** 启用结构化 JSON 输出(deep 角色默认 true) */
  structuredJson?: boolean;
}

/**
 * 获取 Chat 模型实例
 *
 * 历史入口保留,内部委托给 src/llm/factory.ts。所有 LLM 调用仍必须经此创建,
 * 保证重试/超时/角色路由/网关差异只在一处生效。
 */
export function getChatModel(options?: ChatModelOptions): BaseChatModel {
  return createChatModel(options);
}

/** 分类查询的 Prompt */
const CLASSIFY_PROMPT = PromptTemplate.fromTemplate(`
根据用户的问题，判断属于以下哪种查询类型：
- tcm_diagnosis: 中医诊断、辨证、病症分析
- tcm_prescription: 方剂、药物、配伍咨询
- bazi_analysis: 八字、命理、五行分析
- mianxiang_analysis: 面相、五官分析
- yijing_divination: 易经、卦象、占卜
- health_advice: 养生、功法、健康建议
- general_knowledge: 一般知识问答、概念解释
- unknown: 无法确定

只返回类型名称，不要其他内容。

用户问题: {question}
`);

/** 合法查询类型白名单(types.QueryType 的运行时镜像) */
const QUERY_TYPES = new Set<string>([
  "tcm_diagnosis",
  "tcm_prescription",
  "bazi_analysis",
  "mianxiang_analysis",
  "yijing_divination",
  "health_advice",
  "general_knowledge",
  "deep_analysis",
  "unknown",
]);

/**
 * 将 LLM 原始输出规整为合法 QueryType
 *
 * 白名单外一律归一为 "unknown":模型可能返回杂值/句子,
 * 直接 as QueryType 会让脏值流入 API 响应与前端标签映射。
 */
export function normalizeQueryType(raw: string): QueryType {
  const cleaned = raw.trim().toLowerCase();
  return QUERY_TYPES.has(cleaned) ? (cleaned as QueryType) : "unknown";
}

/**
 * 分类查询类型
 */
export async function classifyQuery(question: string): Promise<QueryType> {
  const llm = getChatModel({ role: "classify" });
  const chain = CLASSIFY_PROMPT.pipe(llm).pipe(new StringOutputParser());
  const result = await chain.invoke({ question });
  const queryType = normalizeQueryType(result);
  if (queryType === "unknown") {
    log.debug({ raw: result.slice(0, 50) }, "Query type not recognized");
  }
  return queryType;
}
