/**
 * Agent 编排入口
 *
 * DeepAgent.js 编排(主 agent + deep_analyst subagent)。
 *
 * 对外 API(agenticRag / deepAnalysis)保持稳定;新增结构化 citations[]。
 * 引用规则:工具输出 [ref:<id>],回答中的 id 必须命中本次检索集合,
 * 未命中的 id 会记录在 invalidRefIds 中(用于审计,不阻断回答)。
 */

import { config } from "../config.js";
import { VectorStoreError } from "../errors.js";
import { createLogger } from "../logger.js";
import { classifyQuery } from "../rag/chain.js";
import { mergeCitations, parseCitedRefIds, parseToolCitations, validateCitations } from "../rag/citation.js";
import { collectWithCitations } from "../rag/citation-collector.js";
import type { AnalysisResult, Citation, QueryResult, QueryType } from "../types.js";
import { assertStoreReady } from "../vectorstore/chroma.js";
import { buildDeepAgent, buildDeepAnalystAgent, DEEP_ANALYST_RESPONSE_SCHEMA } from "./deep-agent.js";

const log = createLogger("agents");

/**
 * 分类查询类型(安全版)
 *
 * 分类结果仅用于 meta 标签与响应字段,失败时必须回退 unknown,
 * 绝不允许把一次分类 LLM 调用的失败变成整个问答的失败。
 */
async function safeClassifyQuery(question: string): Promise<QueryType> {
  try {
    return await classifyQuery(question);
  } catch (err) {
    log.warn({ err }, "Query classification failed, falling back to unknown");
    return "unknown";
  }
}

/** 检索工具名(用于统计检索调用与失败) */
const RETRIEVAL_TOOL_NAMES = new Set(["search_knowledge_base", "search_by_domain"]);

/** 对话历史中的一条消息 */
type ChatMessage = { role: "user" | "assistant"; content: string };

function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { role?: unknown; content?: unknown };
  return (v.role === "user" || v.role === "assistant") && typeof v.content === "string";
}

/**
 * 解析对话历史为消息数组
 *
 * 优先按 JSON 消息数组解析(getHistoryForContext 现行输出);
 * 兼容旧 "问: xxx\n答: xxx" 文本格式(该格式在内容含 "\n问: " 时会误切分,
 * 仅作向后兼容保留)。
 */
function parseChatHistory(chatHistory?: string): ChatMessage[] {
  if (!chatHistory) return [];
  try {
    const parsed: unknown = JSON.parse(chatHistory);
    if (Array.isArray(parsed)) {
      return parsed.filter(isChatMessage);
    }
  } catch {
    // 非 JSON,按旧文本格式继续解析
  }
  const messages: ChatMessage[] = [];
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

interface AgentRunOutcome {
  text: string;
  streamedText: string;
  retrievalCalls: number;
  /** 从工具输出文本兜底解析出的引用(不依赖 AsyncLocalStorage) */
  toolCitations: Citation[];
}

/**
 * deep 模式 agenticRag 实现
 *
 * 经 streamEvents v3 统一处理流式/非流式:
 * - run.messages: 逐段输出最终回答文本(调 onToken)
 * - run.toolCalls: 统计检索调用/失败;引用由工具写入 CitationCollector
 * - run.output: 最终状态,取完整回答文本
 *
 * 查询分类与 agent 运行并行发起:分类只贡献 meta 标签,
 * 不应阻塞首 token。
 */
async function deepAgenticRag(
  input: string,
  chatHistory?: string,
  onToken?: (chunk: string) => void,
): Promise<QueryResult> {
  // 先确认真实知识库可用,再花 LLM 的钱;不可用时直接 503,而不是让模型自由发挥
  await assertStoreReady();

  // 分类与 agent 并行;safeClassifyQuery 保证不会 reject
  const classifyPromise = safeClassifyQuery(input);

  const messages = [...parseChatHistory(chatHistory), { role: "user" as const, content: input }];
  const agent = buildDeepAgent();

  const { result, citations } = await collectWithCitations<AgentRunOutcome>(async () => {
    const run = await agent.streamEvents(
      { messages },
      { version: "v3", recursionLimit: config.deepAgentMaxIterations },
    );

    let streamedText = "";
    let retrievalCalls = 0;
    let retrievalFailures = 0;
    const toolCitations: Citation[] = [];

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
          if (!RETRIEVAL_TOOL_NAMES.has(call.name)) continue;
          try {
            const output = await call.output;
            retrievalCalls += 1;
            // 兜底:即使 AsyncLocalStorage 上下文丢失,也能从工具文本恢复引用
            const text = typeof output === "string" ? output : JSON.stringify(output ?? "");
            toolCitations.push(...parseToolCitations(text));
          } catch (err) {
            // 工具失败不能伪装成"没搜到":计数后由下方统一判定
            retrievalFailures += 1;
            log.error({ err, tool: call.name }, "Retrieval tool failed");
          }
        }
      })(),
    ]);

    const state = await run.output;

    // 所有检索都失败 → 明确报错,而不是让"未检索到"的文案掩盖故障
    if (retrievalFailures > 0 && retrievalCalls === 0) {
      throw new VectorStoreError("知识库检索失败，请确认 ChromaDB 与索引状态后重试");
    }

    return {
      text: extractFinalText(state, streamedText),
      streamedText,
      retrievalCalls,
      toolCitations,
    };
  });

  const queryType = await classifyPromise;
  // Collector 是主路径;工具输出解析是兜底,两者按 refId 合并
  const allCitations = mergeCitations(citations, result.toolCitations);
  const citedIds = parseCitedRefIds(result.text);
  const { valid, invalidRefIds } = validateCitations(citedIds, allCitations);

  log.debug(
    { retrieved: allCitations.length, cited: valid.length, invalid: invalidRefIds.length },
    "Citation validation",
  );

  // 没有可验证来源 → 统一回退,避免把模型自身知识伪装成知识库回答
  if (allCitations.length === 0) {
    const fallback = "知识库中暂未检索到与您问题直接相关的内容。请尝试换一种表述方式,或提出更具体的问题。";
    // 流式场景不追加文本:已输出的内容无法撤回,由 done 事件带回最终答案
    if (result.streamedText.length === 0) onToken?.(fallback);
    return { response: fallback, queryType, docCount: 0, citations: [] };
  }

  if (invalidRefIds.length > 0) {
    log.warn({ invalidRefIds }, "Model cited refs outside the retrieved set");
  }

  return {
    response: result.text,
    queryType,
    docCount: allCitations.length,
    citations: allCitations,
    ...(invalidRefIds.length > 0 ? { invalidRefIds } : {}),
  };
}

/** 归一化来源文件名,用于模型引用与检索结果匹配 */
function sourceKey(source: string): string {
  return (source.split(/[\\/]/).pop() ?? source).trim().toLowerCase();
}

/**
 * 用本次真实检索结果校验 /deep 的 references
 *
 * 模型可能编造 source;未命中的条目直接丢弃,命中则用检索到的 domain/refId 回填。
 */
function groundReferences(
  references: AnalysisResult["references"],
  citations: Citation[],
): { references: AnalysisResult["references"]; dropped: number } {
  const bySource = new Map<string, Citation>();
  for (const citation of citations) {
    bySource.set(sourceKey(citation.source), citation);
  }

  const grounded: AnalysisResult["references"] = [];
  let dropped = 0;

  for (const reference of references) {
    const match = bySource.get(sourceKey(reference.source));
    if (!match) {
      dropped += 1;
      continue;
    }
    grounded.push({
      source: match.source,
      content: reference.content.trim() || match.snippet,
      domain: match.domain,
      refId: match.refId,
    });
  }

  return { references: grounded, dropped };
}

/**
 * deep 模式 deepAnalysis 实现
 *
 * 直接调用独立编译的 deep_analyst agent。其模型使用 json_object 输出模式,
 * 最终消息为 JSON 文本,这里手动解析并校验为 DEEP_ANALYST_RESPONSE_SCHEMA。
 * references 必须命中本次检索集合;编造条目会被丢弃并压低置信度。
 */
async function deepDeepAnalysis(input: string): Promise<AnalysisResult> {
  await assertStoreReady();

  const agent = buildDeepAnalystAgent();
  const { result, citations } = await collectWithCitations(() =>
    agent.invoke({ messages: [{ role: "user", content: input }] }, { recursionLimit: config.deepAgentMaxIterations }),
  );

  // 兜底:从工具消息中恢复引用(不依赖 AsyncLocalStorage)
  const toolText = result.messages
    .filter((message) => (message as { _getType?: () => string })._getType?.() === "tool")
    .map((message) => (typeof message.content === "string" ? message.content : ""))
    .join("\n\n");
  const allCitations = mergeCitations(citations, parseToolCitations(toolText));

  const last = result.messages.at(-1);
  const text = typeof last?.content === "string" ? last.content : "";
  const parsed = DEEP_ANALYST_RESPONSE_SCHEMA.safeParse(parseJsonText(text));
  if (!parsed.success) {
    return {
      conclusion: text || "分析失败,请重试。",
      reasoning: "",
      references: [],
      confidence: 0.5,
    };
  }

  const { references, dropped } = groundReferences(parsed.data.references, allCitations);
  if (dropped > 0) {
    log.warn({ dropped, kept: references.length }, "Dropped ungrounded references from deep analysis");
  }

  return {
    ...parsed.data,
    references,
    // 有编造引用时不再给出高置信度
    confidence: dropped > 0 ? Math.min(parsed.data.confidence, 0.6) : parsed.data.confidence,
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
): Promise<QueryResult> {
  return deepAgenticRag(input, chatHistory, onToken);
}

/**
 * 深度分析(DeepAgent.js deep_analyst 子代理)
 */
export async function deepAnalysis(input: string): Promise<AnalysisResult> {
  return deepDeepAnalysis(input);
}
