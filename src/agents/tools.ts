/**
 * Agent 工具层 (DeepAgent.js 版)
 *
 * 使用 LangChain 1.x `tool()` + zod 定义工具,供 DeepAgent 编排使用。
 * 每个检索工具返回的文档首行带 `【来源】file > h2 | domain` 引用锚点,
 * 供提示词中的 [ref-N] 引用机制匹配。
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { searchByDomain, searchKnowledge } from "../vectorstore/chroma.js";

/** 知识库领域枚举(与 ingestion 的 inferDomain 保持一致) */
export const KNOWLEDGE_DOMAINS = [
  "黄帝内经",
  "伤寒论",
  "金匮要略",
  "神农本草经",
  "针灸",
  "天纪",
  "命理八字",
  "面相学",
  "中医临床",
  "养生功法",
  "方剂",
  "医案",
  "阴实理论",
  "文集",
] as const;

/** 工具输出截断上限(每文档,与旧 DynamicTool 行为一致) */
const DOC_TRUNCATE = 800;

/**
 * 将检索结果格式化为带引用锚点的文本
 */
function formatDocs(docs: Awaited<ReturnType<typeof searchKnowledge>>): string {
  if (docs.length === 0) return "未找到相关知识。";
  return docs
    .map(
      (doc, i) =>
        `[${i + 1}] 【来源】${doc.metadata.source}${
          doc.metadata.h2 ? ` > ${doc.metadata.h2}` : ""
        } | ${doc.metadata.domain}
${doc.pageContent.slice(0, DOC_TRUNCATE)}`,
    )
    .join("\n\n---\n\n");
}

/**
 * 知识库通用搜索工具
 *
 * 输入一个中文查询语句,返回相关的知识段落。
 * 当用户询问中医、命理、八字、面相、养生、方剂等问题时,使用此工具获取参考知识。
 */
export const searchKnowledgeBaseTool = tool(
  async ({ query, topK }) => {
    const docs = await searchKnowledge(query, topK ?? 5);
    return formatDocs(docs);
  },
  {
    name: "search_knowledge_base",
    description: `搜索倪海厦中医命理知识库。输入一个中文查询语句,返回相关的知识段落。
当用户询问中医、命理、八字、面相、养生、方剂等问题时,使用此工具获取参考知识。
输入应当是一个具体的中文问题或关键词。`,
    schema: z.object({
      query: z.string().describe("中文查询语句,应当具体明确"),
      topK: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("返回文档数量,默认 5"),
    }),
  },
);

/**
 * 按领域搜索工具
 */
export const searchByDomainTool = tool(
  async ({ domain, query, topK }) => {
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
      domain: z
        .enum(KNOWLEDGE_DOMAINS)
        .describe("知识领域,必须是枚举列表中的值"),
      query: z.string().describe("中文查询语句,应当具体明确"),
      topK: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("返回文档数量,默认 5"),
    }),
  },
);

/** 供 DeepAgent 注册的全部工具 */
export const allTools = [searchKnowledgeBaseTool, searchByDomainTool];
