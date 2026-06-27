import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnableSequence } from "@langchain/core/runnables";
import { config } from "../config.js";
import { searchKnowledge } from "../vectorstore/chroma.js";
import { classifyQuery } from "../rag/chain.js";
import { formatRetrievedDocs } from "./tools.js";
import type {
  AgentState,
  KnowledgeDocument,
  QueryType,
  AnalysisResult,
} from "../types.js";

/** 获取 LLM 实例 */
function getLLM(): ChatOpenAI {
  return new ChatOpenAI({
    model: config.llmModel,
    temperature: config.llmTemperature,
    configuration: {
      baseURL: config.openaiBaseUrl,
      apiKey: config.openaiApiKey,
    },
  });
}

/**
 * 查询分析路由
 * 判断用户意图，决定检索策略
 */
async function queryRouter(input: string): Promise<{
  queryType: QueryType;
  searchQueries: string[];
  needsClarification: boolean;
}> {
  const queryType = await classifyQuery(input);
  let searchQueries: string[];

  switch (queryType) {
    case "tcm_diagnosis":
      searchQueries = [
        input,
        `辨证 ${input}`,
        `症状 ${input}`,
      ];
      break;
    case "tcm_prescription":
      searchQueries = [
        input,
        `方剂 ${input}`,
        `药物 ${input}`,
      ];
      break;
    case "bazi_analysis":
      searchQueries = [
        input,
        `八字 ${input}`,
        `命理 ${input}`,
        `五行 ${input}`,
      ];
      break;
    case "mianxiang_analysis":
      searchQueries = [
        input,
        `面相 ${input}`,
        `麻衣神相 ${input}`,
      ];
      break;
    case "yijing_divination":
      searchQueries = [
        input,
        `易经 ${input}`,
        `卦 ${input}`,
        `天纪 ${input}`,
      ];
      break;
    case "health_advice":
      searchQueries = [
        input,
        `养生 ${input}`,
        `功法 ${input}`,
      ];
      break;
    default:
      searchQueries = [input];
  }

  return { queryType, searchQueries, needsClarification: false };
}

/**
 * 检索阶段：使用多个查询从知识库检索，合并去重
 */
async function retrievalStage(
  searchQueries: string[]
): Promise<KnowledgeDocument[]> {
  // 多查询检索：用每个查询同时检索，再合并去重
  const allResults = await Promise.all(
    searchQueries.map((q) => searchKnowledge(q, config.retrievalTopK))
  );

  // 合并 + 去重（基于 pageContent + metadata.source）
  const seen = new Set<string>();
  const merged: KnowledgeDocument[] = [];
  for (const docs of allResults) {
    for (const doc of docs) {
      const key = `${doc.metadata.source}:${doc.pageContent.slice(0, 80)}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(doc);
      }
    }
  }

  // 按相关度分数排序（保留各查询各自排序）
  return merged.slice(0, config.retrievalTopK);
}

// ---- 分析 Prompts ----

const TCM_DIAGNOSIS_PROMPT = PromptTemplate.fromTemplate(`
你是一位精通倪海厦中医理论的中医专家。请基于知识库内容进行辨证分析。

## 知识库参考
{context}

## 用户描述
{input}

## 辨证分析要求
1. 识别主要症状和体征
2. 结合知识库中的辨证理论（六经辨证、八纲辨证等）
3. 分析病因病机
4. 给出可能的证型判断
5. 引用具体知识来源（文件名和章节）
6. 如有处方建议，提供方剂名称和参考来源

## 警告
- 说明这仅为基于知识库的理论分析
- 不能替代执业医师的面诊和诊断
- 急症应建议立即就医

## 分析
`);

const BAZI_ANALYSIS_PROMPT = PromptTemplate.fromTemplate(`
你是一位精通倪海厦天纪体系和传统命理学的命理专家。请基于知识库内容进行命理分析。

## 知识库参考
{context}

## 用户问题
{input}

## 命理分析要求
1. 结合八字/命理知识进行分析
2. 引用滴天髓、子平法等经典来源
3. 分析五行生克、格局成败
4. 给出相应的建议
5. 引用具体知识来源

## 分析
`);

const TCM_PRESCRIPTION_PROMPT = PromptTemplate.fromTemplate(`
你是一位精通倪海厦经方体系的中医方剂专家。请基于知识库内容进行方剂分析。

## 知识库参考
{context}

## 用户问题
{input}

## 方剂分析要求
1. 识别方剂的组成、君臣佐使配伍
2. 说明方剂的主治和适应症
3. 分析药物的性味归经和相互作用
4. 如有剂量信息，提供参考剂量
5. 引用具体知识来源（文件名和章节）
6. 若涉及多种方剂，对比其异同

## 警告
- 仅为基于知识库的理论分析
- 不能替代执业中医师的处方
- 实际用药需因人辨证施治

## 分析
`);

const HEALTH_ADVICE_PROMPT = PromptTemplate.fromTemplate(`
你是一位精通倪海厦养生功法体系的中医养生专家。请基于知识库内容提供养生建议。

## 知识库参考
{context}

## 用户问题
{input}

## 养生分析要求
1. 结合四季养生、五运六气理论
2. 推荐具体的功法（如八段锦、五禽戏等）
3. 说明饮食调养和作息建议
4. 引用具体知识来源
5. 区分预防性养生和调理性养生

## 警告
- 养生建议不能替代医疗诊断
- 有明确病症时应优先就医
- 运动需量力而行

## 建议
`);

const MIANXIANG_ANALYSIS_PROMPT = PromptTemplate.fromTemplate(`
你是一位精通倪海厦天纪体系和传统相学的面相专家。请基于知识库内容进行面相分析。

## 知识库参考
{context}

## 用户问题
{input}

## 面相分析要求
1. 结合麻衣神相等传统相学理论
2. 分析五官（眉、眼、鼻、口、耳）的相理
3. 说明气色、纹路的吉凶含义
4. 引用具体知识来源
5. 强调面相是参考，不可绝对化

## 分析
`);

const GENERAL_QA_PROMPT = PromptTemplate.fromTemplate(`
你是一位精通倪海厦中医命理知识体系的专家。请基于提供的知识库内容回答用户问题。

## 知识库参考
{context}

## 用户问题
{input}

## 回答要求
1. 严格基于知识库内容
2. 引用具体来源（文件名、章节标题）
3. 回答要结构化、层次清晰
4. 涉及诊断或健康建议时，需加免责声明

## 回答
`);

/**
 * 根据查询类型选择对应的 Prompt
 */
function getPromptForType(queryType: QueryType) {
  switch (queryType) {
    case "tcm_diagnosis":
      return TCM_DIAGNOSIS_PROMPT;
    case "tcm_prescription":
      return TCM_PRESCRIPTION_PROMPT;
    case "bazi_analysis":
    case "yijing_divination":
      return BAZI_ANALYSIS_PROMPT;
    case "mianxiang_analysis":
      return MIANXIANG_ANALYSIS_PROMPT;
    case "health_advice":
      return HEALTH_ADVICE_PROMPT;
    default:
      return GENERAL_QA_PROMPT;
  }
}

/**
 * Agentic RAG 主流程
 * 1. 路由 → 2. 检索 → 3. 增强分析 → 4. 生成回复
 */
export async function agenticRag(
  input: string,
  chatHistory?: string
): Promise<{
  response: string;
  queryType: QueryType;
  docCount: number;
}> {
  // Step 1: 路由 - 识别查询类型和搜索策略
  const route = await queryRouter(input);

  // Step 2: 检索 - 从知识库获取相关内容
  const docs = await retrievalStage(route.searchQueries);
  const context = formatRetrievedDocs(docs);

  // Step 3: 增强分析 - 选择合适的 Prompt 并生成
  const llm = getLLM();
  const prompt = getPromptForType(route.queryType);

  let finalPrompt: string;
  if (chatHistory) {
    finalPrompt = `
## 对话历史
${chatHistory}

## 新问题
${input}`;
  } else {
    finalPrompt = input;
  }

  const chain = prompt.pipe(llm).pipe(new StringOutputParser());
  const response = await chain.invoke({
    context: context || "未检索到相关知识库内容。请基于你的知识回答。",
    input: finalPrompt,
  });

  return {
    response,
    queryType: route.queryType,
    docCount: docs.length,
  };
}

/**
 * 批量分析（用于处理复杂任务）
 */
export async function deepAnalysis(input: string): Promise<AnalysisResult> {
  const docs = await searchKnowledge(input, 8);
  const context = formatRetrievedDocs(docs);

  const llm = getLLM();
  const analysisPrompt = PromptTemplate.fromTemplate(`
你是一位资深中医命理分析师。请对以下问题进行深度分析，输出结构化结果。

## 知识库参考
{context}

## 问题
{input}

## 输出格式（JSON）
{{
  "conclusion": "分析结论",
  "reasoning": "推理过程（分步骤）",
  "references": [{{"source": "文件名", "content": "引用内容", "domain": "领域"}}],
  "confidence": 0.8,
  "suggestions": ["建议1", "建议2"]
}}

## 分析结果
`);

  const chain = analysisPrompt.pipe(llm).pipe(new StringOutputParser());
  const result = await chain.invoke({ context, input });

  // 尝试解析为 JSON
  try {
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as AnalysisResult;
    }
  } catch {
    // fallback: 返回文本结果
  }

  return {
    conclusion: result,
    reasoning: "",
    references: docs.map((d) => ({
      source: d.metadata.source,
      content: d.pageContent.slice(0, 200),
      domain: d.metadata.domain,
    })),
    confidence: 0.5,
  };
}
