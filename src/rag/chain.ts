import { StringOutputParser } from "@langchain/core/output_parsers";
import { PromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { config } from "../config.js";
import { createLogger } from "../logger.js";
import type { QueryType } from "../types.js";

const log = createLogger("rag:chain");

/** 统一 Chat 模型工厂 */
export interface ChatModelOptions {
  /** 覆盖模型名(如 /deep 的 deepModel) */
  model?: string;
  /** 覆盖温度 */
  temperature?: number;
  /** 透传底层模型参数(如 response_format、thinking 开关) */
  modelKwargs?: Record<string, unknown>;
}

/**
 * 获取 Chat 模型实例
 *
 * 所有 LLM 调用必须经此创建,保证三件事全局一致:
 * - 重试:maxRetries 接 config.llmMaxRetries(限流/5xx 走 SDK 内置指数退避,
 *   不再裸抛到业务层;此前该配置存在但从未接线)
 * - 温度/模型/baseURL/apiKey 统一走 config
 * - modelKwargs 仅在确有需要时透传(如 deep_analyst 的 json_object 模式)
 */
export function getChatModel(options?: ChatModelOptions): ChatOpenAI {
  return new ChatOpenAI({
    model: options?.model ?? config.llmModel,
    temperature: options?.temperature ?? config.llmTemperature,
    maxRetries: config.llmMaxRetries,
    modelKwargs: options?.modelKwargs,
    configuration: {
      baseURL: config.openaiBaseUrl,
      apiKey: config.openaiApiKey,
    },
  });
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
  const llm = getChatModel();
  const chain = CLASSIFY_PROMPT.pipe(llm).pipe(new StringOutputParser());
  const result = await chain.invoke({ question });
  const queryType = normalizeQueryType(result);
  if (queryType === "unknown") {
    log.debug({ raw: result.slice(0, 50) }, "Query type not recognized");
  }
  return queryType;
}
