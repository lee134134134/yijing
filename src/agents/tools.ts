/**
 * Agent 工具层 (DeepAgent.js 版)
 *
 * 使用 LangChain 1.x `tool()` + zod 定义工具,供 DeepAgent 编排使用。
 * 每个检索工具返回的文档首行带 `【来源】file > h2 | domain` 引用锚点,
 * 供提示词中的 [ref-N] 引用机制匹配。
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { config } from "../config.js";
import { buildCitation } from "../rag/citation.js";
import { getCitationCollector } from "../rag/citation-collector.js";
import { rewriteQuery } from "../rag/query-rewriting.js";
import type { RetrievedDocument } from "../types.js";
import { multiQuerySearch, searchByDomain, searchKnowledge } from "../vectorstore/chroma.js";

/** 知识库领域枚举(与 ingestion 的 inferDomain 保持一致) */
export const KNOWLEDGE_DOMAINS = [
  "黄帝内经",
  "伤寒论",
  "金匮要略",
  "神农本草经",
  "针灸",
  "天纪",
  "紫微斗数",
  "命理八字",
  "面相学",
  "中医临床",
  "养生功法",
  "方剂",
  "医案",
  "阴实理论",
  "文集",
  "综合",
] as const;

/** 工具输出截断上限(每文档,与旧 DynamicTool 行为一致) */
const DOC_TRUNCATE = 800;

/**
 * 将检索结果格式化为带稳定引用锚点的文本
 *
 * 每个唯一文档输出 `[ref:<8位id>]`,并写入请求级 CitationCollector。
 * 同一次请求内重复检索到同一块时按 refId 去重,避免模型看到重复编号。
 */
function formatDocs(docs: RetrievedDocument[]): string {
  if (docs.length === 0) return "未找到相关知识。";

  const collector = getCitationCollector();
  const seen = new Set<string>();
  const blocks: string[] = [];

  for (const doc of docs) {
    const citation = buildCitation(doc);
    if (seen.has(citation.refId)) continue;
    seen.add(citation.refId);
    collector?.add(citation);

    const section = citation.h2 ? ` > ${citation.h2}` : "";
    const score = citation.score !== undefined ? ` | 相关度 ${citation.score.toFixed(2)}` : "";
    blocks.push(
      `[ref:${citation.refId}] 【来源】${citation.source}${section} | ${citation.domain}${score}\n${doc.pageContent.slice(0, DOC_TRUNCATE)}`,
    );
  }

  return blocks.join("\n\n---\n\n");
}

/**
 * 通用检索入口
 *
 * 开启 ENABLE_QUERY_REWRITE 时(默认开启):先用 LLM 把口语化查询改写为
 * 多个检索友好子查询,再经 RRF 多查询融合提升召回;rewriteQuery 内部
 * 失败时自动回退原查询,不会阻断检索。否则直连单查询检索。
 */
async function retrieveKnowledge(query: string, topK: number): Promise<RetrievedDocument[]> {
  if (!config.enableQueryRewrite) return searchKnowledge(query, topK);
  const rewritten = await rewriteQuery(query, config.rewriteNumQueries);
  return multiQuerySearch(rewritten.all, topK);
}

/**
 * 知识库通用搜索工具
 *
 * 输入一个中文查询语句,返回相关的知识段落。
 * 当用户询问中医、命理、八字、面相、养生、方剂等问题时,使用此工具获取参考知识。
 */
export const searchKnowledgeBaseTool = tool(
  async ({ query, topK }) => {
    const budget = getCitationCollector();
    if (budget && !budget.tryConsumeRetrieval()) {
      return "本次检索次数已达上限，请基于已获得的资料回答，不要继续检索。";
    }
    const docs = await retrieveKnowledge(query, topK ?? 5);
    return formatDocs(docs);
  },
  {
    name: "search_knowledge_base",
    description: `搜索倪海厦中医命理知识库。输入一个中文查询语句,返回相关的知识段落。
当用户询问中医、命理、八字、面相、养生、方剂等问题时,使用此工具获取参考知识。
输入应当是一个具体的中文问题或关键词。`,
    schema: z.object({
      query: z.string().describe("中文查询语句,应当具体明确"),
      topK: z.number().int().min(1).max(20).optional().describe("返回文档数量,默认 5"),
    }),
  },
);

/**
 * 按领域搜索工具
 */
export const searchByDomainTool = tool(
  async ({ domain, query, topK }) => {
    const budget = getCitationCollector();
    if (budget && !budget.tryConsumeRetrieval()) {
      return "本次检索次数已达上限，请基于已获得的资料回答，不要继续检索。";
    }
    const docs = await searchByDomain(query, domain, topK ?? 5);
    if (docs.length === 0) {
      return `领域 "${domain}" 中未找到相关内容。`;
    }
    return formatDocs(docs);
  },
  {
    name: "search_by_domain",
    description: `按知识领域搜索倪海厦知识库。领域范围: ${KNOWLEDGE_DOMAINS.join("、")}。
当用户明确提到某个领域(如"伤寒论""命理八字"),或在跨领域分析中需要针对特定领域检索时使用。
如果不确定领域,请使用 search_knowledge_base。`,
    schema: z.object({
      domain: z.enum(KNOWLEDGE_DOMAINS).describe("知识领域,必须是枚举列表中的值"),
      query: z.string().describe("中文查询语句,应当具体明确"),
      topK: z.number().int().min(1).max(20).optional().describe("返回文档数量,默认 5"),
    }),
  },
);

/** 供 DeepAgent 注册的全部工具 */
export const allTools = [searchKnowledgeBaseTool, searchByDomainTool];
