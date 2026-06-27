import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { config } from "../config.js";
import { searchKnowledge, searchByDomain } from "../vectorstore/chroma.js";
import type { KnowledgeDocument, QueryType } from "../types.js";

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

/** 格式化检索到的文档为上下文文本 */
function formatDocsAsContext(docs: KnowledgeDocument[]): string {
  return docs
    .map((doc, i) => {
      const meta = doc.metadata;
      const header = `[${i + 1}] 来源: ${meta.source}${
        meta.h2 ? ` > ${meta.h2}` : ""
      }${meta.h3 ? ` > ${meta.h3}` : ""} | 领域: ${meta.domain}`;
      return `${header}\n${doc.pageContent.slice(0, 1000)}\n`;
    })
    .join("\n---\n");
}

/** 通用问答 Prompt */
const QA_PROMPT = PromptTemplate.fromTemplate(`
你是一位精通倪海厦中医命理知识体系的中医/命理专家。请基于提供的知识库内容回答用户问题。

## 回答要求
1. 严格基于提供的知识库内容回答，不要编造不存在的知识
2. 如果知识库内容不足以回答问题，请明确说明
3. 引用具体来源（文件名、章节标题）
4. 回答要结构化、层次清晰，适合中文阅读
5. 涉及诊断或健康建议时，必须加免责声明

## 知识库参考内容
{context}

## 用户问题
{question}

## 回答
`);

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
 * 直接 RAG 问答（无 Agent 的简化版）
 */
export async function simpleRagQuery(
  question: string,
  topK: number = config.retrievalTopK
): Promise<string> {
  // 1. 检索
  const docs = await searchKnowledge(question, topK);
  const context = formatDocsAsContext(docs);

  // 2. 生成
  const llm = getChatModel();
  const chain = QA_PROMPT.pipe(llm).pipe(new StringOutputParser());
  const response = await chain.invoke({
    context,
    question,
  });

  return response;
}

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

/**
 * 带领域过滤的 RAG 查询
 */
export async function domainSpecificRagQuery(
  question: string,
  domain: string
): Promise<string> {
  const docs = await searchByDomain(question, domain, config.retrievalTopK);
  const context = formatDocsAsContext(docs);

  const llm = getChatModel();
  const domainPrompt = PromptTemplate.fromTemplate(`
你是一位精通{domain}的专家。请基于提供的知识库内容回答用户问题。

## 知识库参考内容
{context}

## 用户问题
{question}

## 回答要求
1. 严格基于提供的知识库内容
2. 引用具体来源
3. 涉及诊断或健康建议时，必须加免责声明

## 回答
`);

  const chain = domainPrompt.pipe(llm).pipe(new StringOutputParser());
  const response = await chain.invoke({
    domain,
    context,
    question,
  });

  return response;
}
