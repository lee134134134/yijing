import { StringOutputParser } from "@langchain/core/output_parsers";
import { PromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { config } from "../config.js";
import type { QueryType } from "../types.js";

/** 获取 Chat 模型实例 */
export function getChatModel(): ChatOpenAI {
  return new ChatOpenAI({
    model: config.llmModel,
    temperature: config.llmTemperature,
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

/**
 * 分类查询类型
 */
export async function classifyQuery(question: string): Promise<QueryType> {
  const llm = getChatModel();
  const chain = CLASSIFY_PROMPT.pipe(llm).pipe(new StringOutputParser());
  const result = await chain.invoke({ question });
  const cleanType = result.trim().toLowerCase() as QueryType;
  return cleanType;
}
