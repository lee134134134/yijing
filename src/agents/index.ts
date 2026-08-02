import { StringOutputParser } from "@langchain/core/output_parsers";
import { PromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { config } from "../config.js";
import { ErrorCode, LLMError } from "../errors.js";
import { classifyQuery } from "../rag/chain.js";
import { rewriteQuery } from "../rag/query-rewriting.js";
import { prepareContext } from "../rag/context-manager.js";
import { buildCitedContext, parseCitations, formatCitations } from "../rag/citation.js";
import type { AnalysisResult, KnowledgeDocument, QueryType } from "../types.js";
import { multiQuerySearch, searchKnowledge } from "../vectorstore/chroma.js";

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
  needsClarification: boolean;
}> {
  const queryType = await classifyQuery(input);
  return { queryType, needsClarification: false };
}

/**
 * 检索阶段：查询重写 + 多查询 RRF 融合检索
 *
 * 1. 使用 LLM 将用户问题重写为检索友好的多个查询
 * 2. 对每个查询执行向量检索
 * 3. 通过 RRF 融合排序 + 去重
 */
async function retrievalStage(input: string, queryType?: string): Promise<KnowledgeDocument[]> {
  if (config.enableQueryRewrite) {
    const rewritten = await rewriteQuery(input, config.rewriteNumQueries, queryType);
    return multiQuerySearch(rewritten.all, config.retrievalTopK);
  }

  // 不启用重写时，直接用原始查询 + domain 前缀做多角度检索
  const queries = [input];
  return multiQuerySearch(queries, config.retrievalTopK);
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
5. 引用具体知识来源，使用 [ref-N] 格式标记
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
2. 引用滴天髓、子平法等经典来源，使用 [ref-N] 格式标记
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
5. 引用具体知识来源，使用 [ref-N] 格式标记
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
4. 引用具体知识来源，使用 [ref-N] 格式标记
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
4. 引用具体知识来源，使用 [ref-N] 格式标记
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
2. 引用具体来源时，使用 [ref-N] 格式标记（如伤寒论条文引用 [ref-1]）
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
 * 带指数退避的重试包装器
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = config.llmMaxRetries,
  baseDelayMs: number = config.llmRetryBaseDelay,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries - 1) {
        const delay = baseDelayMs * 2 ** attempt;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  if (lastError instanceof LLMError) throw lastError;
  throw new LLMError(ErrorCode.LLM_UNAVAILABLE, `LLM 调用超过最大重试次数 (${maxRetries})`, {
    cause: lastError,
  });
}

/**
 * 使用 LLM 对检索结果进行重排序
 */
async function rerankDocs(query: string, docs: KnowledgeDocument[], topK: number): Promise<KnowledgeDocument[]> {
  if (docs.length <= 1) return docs;
  try {
    const llm = getLLM();
    const docList = docs
      .map(
        (d, i) =>
          `[${i}] 来源: ${d.metadata.source} 章节: ${d.metadata.h2 || ""} ${d.metadata.h3 || ""}\n${d.pageContent.slice(0, 500)}`,
      )
      .join("\n\n");

    const prompt = `Rate the relevance of each knowledge document to the user query. Return ONLY a JSON array of scores: [score0, score1, ...] where each score is 0-10.

User query: ${query}

Documents:
${docList}

JSON scores:`;

    const response = await withRetry(() => llm.invoke(prompt));
    const text = typeof response === "string" ? response : response.content;
    const jsonMatch = typeof text === "string" ? text.match(/\[[\d.,\s]+\]/) : null;
    if (!jsonMatch) return docs.slice(0, topK);

    const scores = JSON.parse(jsonMatch[0]) as number[];
    if (!Array.isArray(scores) || scores.length !== docs.length) return docs.slice(0, topK);

    const scored = docs.map((doc, i) => ({ doc, score: scores[i] ?? 0 })).sort((a, b) => b.score - a.score);

    return scored.slice(0, topK).map((s) => s.doc);
  } catch {
    return docs.slice(0, topK);
  }
}

/**
 * Agentic RAG 主流程
 * 1. 路由 → 2. 检索 → 3. 增强分析 → 4. 生成回复
 *
 * @param onToken - 流式回调。提供时，LLM 输出将逐 token 回调，非流式模式使用 withRetry
 */
export async function agenticRag(
  input: string,
  chatHistory?: string,
  onToken?: (chunk: string) => void,
): Promise<{
  response: string;
  queryType: QueryType;
  docCount: number;
}> {
  // Step 1: 路由 - 识别查询类型
  const { queryType } = await queryRouter(input);

  // Step 2: 检索 - 查询重写 + 多查询 RRF 融合
  let docs = await retrievalStage(input, queryType);

  // Step 2a: 可选重排序
  if (config.enableReranking && docs.length > 1) {
    docs = await rerankDocs(input, docs, config.retrievalTopK);
  }

  // Step 2b: 构建引用上下文 + Token 预算裁剪
  const cited = buildCitedContext(docs);
  const prepared = prepareContext(docs);
  const context = prepared.context;

  // Step 3: 增强分析 - 选择合适的 Prompt 并生成
  const llm = getLLM();
  const prompt = getPromptForType(queryType);

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

  let responseText: string;

  // Self-reflection: 如果没有检索到有效文档，直接告知用户并返回
  if (prepared.docCount === 0) {
    responseText = "知识库中暂未检索到与您问题直接相关的内容。请尝试换一种表述方式，或提出更具体的问题。";
  } else {
    const chain = prompt.pipe(llm).pipe(new StringOutputParser());
    const chainInput = {
      context: context || "未检索到相关知识库内容。请基于你的知识回答。",
      input: finalPrompt,
    };

    if (onToken) {
      // 流式模式：逐 token 回调，最后发送脚注
      responseText = "";
      const stream = await chain.stream(chainInput);
      for await (const chunk of stream) {
        const text = typeof chunk === "string" ? chunk : String(chunk);
        responseText += text;
        onToken(text);
      }
    } else {
      // 非流式模式：带重试
      responseText = await withRetry(() => chain.invoke(chainInput));
    }

    // Step 3a: 解析引用 + 追加脚注
    const { citedRefs } = parseCitations(responseText, cited.entries);
    if (citedRefs.length > 0) {
      const footnotes = formatCitations(citedRefs, cited.entries);
      responseText += footnotes;
      if (onToken) {
        onToken(footnotes);
      }
    }
  }

  return {
    response: responseText,
    queryType,
    docCount: prepared.docCount,
  };
}

/**
 * 批量分析（用于处理复杂任务）
 */
export async function deepAnalysis(input: string): Promise<AnalysisResult> {
  const docs = config.enableQueryRewrite
    ? await multiQuerySearch([input], 8)
    : await searchKnowledge(input, 8);
  const prepared = prepareContext(docs);
  const context = prepared.context;

  const llm = getLLM();
  const analysisPrompt = PromptTemplate.fromTemplate(`
 你是一位资深中医命理分析师。请对以下问题进行深度分析，输出结构化结果。

## 知识库参考
{context}

## 问题
{input}

## 输出格式
你必须输出一个合法的 JSON 对象（不要包裹在代码块中），包含以下字段：
- conclusion (string): 分析结论
- reasoning (string): 推理过程（分步骤）
- references (array): 引用的知识来源，每项包含 source (文件名)、content (引用内容)、domain (领域)
- confidence (number): 置信度，范围 0-1
- suggestions (array of string, 可选): 建议列表

## 分析结果
`);

  const chain = analysisPrompt.pipe(llm).pipe(new StringOutputParser());
  const result = await withRetry(() => chain.invoke({ context, input }));

  const analysisSchema = z.object({
    conclusion: z.string().min(1),
    reasoning: z.string(),
    references: z.array(
      z.object({
        source: z.string().min(1),
        content: z.string(),
        domain: z.string(),
      }),
    ),
    confidence: z.number().min(0).max(1),
    suggestions: z.array(z.string()).optional(),
  });

  function tryParse(text: string) {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return jsonMatch ? analysisSchema.safeParse(JSON.parse(jsonMatch[0])) : null;
  }

  const parsed = tryParse(result);
  if (parsed?.success) return parsed.data;

  const fixPrompt = PromptTemplate.fromTemplate(`
之前的 JSON 格式有误，请只输出合法的 JSON，不要其他文字。

错误: {error}

要求格式:
{{
  "conclusion": "分析结论",
  "reasoning": "推理过程",
  "references": [{{"source": "", "content": "", "domain": ""}}],
  "confidence": 0.8
}}

请重新输出：
`);
  const errorMsg = parsed === null ? "未找到 JSON 对象" : parsed.error.message;
  const fixed = await withRetry(() =>
    fixPrompt.pipe(llm).pipe(new StringOutputParser()).invoke({ error: errorMsg }),
  );
  const fixedParsed = tryParse(fixed);
  if (fixedParsed?.success) return fixedParsed.data;

  // fallback: 返回文本结果
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
