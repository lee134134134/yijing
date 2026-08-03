/**
 * Agent 编排入口
 *
 * DeepAgent.js 编排(主 agent + deep_analyst subagent)。
 *
 * 对外 API(agenticRag / deepAnalysis)签名与迁移前保持一致,
 * 响应结构兼容(引用 [ref-N] 脚注由 deep 系统提示词保证)。
 */

import { config } from "../config.js";
import { classifyQuery } from "../rag/chain.js";
import type { AnalysisResult, QueryType } from "../types.js";
import { buildDeepAgent, buildDeepAnalystAgent, DEEP_ANALYST_RESPONSE_SCHEMA } from "./deep-agent.js";

/** 检索工具名(用于 docCount 统计) */
const RETRIEVAL_TOOL_NAMES = new Set(["search_knowledge_base", "search_by_domain"]);

/** 统计工具输出中的来源文档数(每个 【来源】 锚点计 1) */
function countSourceDocs(output: unknown): number {
  const text = typeof output === "string" ? output : JSON.stringify(output ?? "");
  const matches = text.match(/【来源】/g);
  return matches?.length ?? 0;
}

/**
 * 解析对话历史字符串("问: xxx\n答: xxx" 格式)为消息数组
 */
function parseChatHistory(chatHistory?: string): Array<{ role: "user" | "assistant"; content: string }> {
  if (!chatHistory) return [];
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const line of chatHistory.split("\n")) {
    const m = line.match(/^(问|答): (.*)$/);
    if (m) {
      messages.push({
        role: m[1] === "问" ? "user" : "assistant",
        content: m[2].trim(),
      });
    }
  }
  return messages;
}

/** 从 agent 最终状态提取最后一条 assistant 消息文本 */
function extractFinalText(state: { messages?: Array<{ content?: unknown }> }, streamed: string): string {
  const last = state.messages?.at(-1);
  if (typeof last?.content === "string" && last.content.trim()) return last.content;
  return streamed;
}

/**
 * deep 模式 agenticRag 实现
 *
 * 经 streamEvents v3 统一处理流式/非流式:
 * - run.messages: 逐段输出最终回答文本(调 onToken)
 * - run.toolCalls: 统计检索工具调用,近似 docCount
 * - run.output: 最终状态,取完整回答文本
 */
async function deepAgenticRag(
  input: string,
  chatHistory?: string,
  onToken?: (chunk: string) => void,
): Promise<{ response: string; queryType: QueryType; docCount: number }> {
  const queryType = await classifyQuery(input);

  const messages = [...parseChatHistory(chatHistory), { role: "user" as const, content: input }];

  const agent = buildDeepAgent();
  const run = await agent.streamEvents({ messages }, { version: "v3", recursionLimit: config.deepAgentMaxIterations });

  let streamedText = "";
  let docCount = 0;
  let retrievalCalls = 0;

  await Promise.all([
    (async () => {
      for await (const msg of run.messages) {
        for await (const token of msg.text) {
          streamedText += token;
          onToken?.(token);
        }
      }
    })(),
    (async () => {
      for await (const call of run.toolCalls) {
        if (RETRIEVAL_TOOL_NAMES.has(call.name)) {
          retrievalCalls += 1;
          const output = await call.output;
          docCount += countSourceDocs(output);
        }
      }
    })(),
  ]);

  const state = await run.output;
  const responseText = extractFinalText(state, streamedText);

  // 空结果回退: 无检索调用且回答无引用 → 与旧管线一致的提示语
  const hasCitation = /\[ref-\d+\]/.test(responseText) || responseText.includes("参考来源");
  if (retrievalCalls === 0 && !hasCitation) {
    const fallback = "知识库中暂未检索到与您问题直接相关的内容。请尝试换一种表述方式,或提出更具体的问题。";
    if (onToken) onToken(fallback);
    return { response: fallback, queryType, docCount: 0 };
  }

  return { response: responseText, queryType, docCount };
}

/**
 * deep 模式 deepAnalysis 实现
 *
 * 直接调用独立编译的 deep_analyst agent。其模型使用 json_object 输出模式,
 * 最终消息为 JSON 文本,这里手动解析并校验为 DEEP_ANALYST_RESPONSE_SCHEMA。
 * 解析失败时回退为文本结论(与旧管线 fallback 语义一致)。
 */
async function deepDeepAnalysis(input: string): Promise<AnalysisResult> {
  const agent = buildDeepAnalystAgent();
  const result = await agent.invoke(
    { messages: [{ role: "user", content: input }] },
    { recursionLimit: config.deepAgentMaxIterations },
  );

  const last = result.messages.at(-1);
  const text = typeof last?.content === "string" ? last.content : "";
  const parsed = DEEP_ANALYST_RESPONSE_SCHEMA.safeParse(parseJsonText(text));
  if (parsed.success) return parsed.data;

  return {
    conclusion: text || "分析失败,请重试。",
    reasoning: "",
    references: [],
    confidence: 0.5,
  };
}

/** 从模型输出文本中提取 JSON 对象(兼容 ```json 代码块包裹) */
function parseJsonText(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const candidate = fenced?.[1] ?? trimmed;
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return null;
  }
}

/**
 * Agentic RAG 主流程(DeepAgent.js 编排)
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
  return deepAgenticRag(input, chatHistory, onToken);
}

/**
 * 深度分析(DeepAgent.js deep_analyst 子代理)
 */
export async function deepAnalysis(input: string): Promise<AnalysisResult> {
  return deepDeepAnalysis(input);
}
