import { DynamicTool } from "langchain/tools";
import { classifyQuery } from "../rag/chain.js";
import type { KnowledgeDocument } from "../types.js";
import { searchByDomain, searchKnowledge } from "../vectorstore/chroma.js";

/**
 * 知识库搜索工具
 */
export const knowledgeSearchTool = new DynamicTool({
  name: "search_knowledge_base",
  description: `搜索倪海厦中医命理知识库。输入一个中文查询语句，返回相关的知识段落。
当用户询问中医、命理、八字、面相、养生、方剂等问题时，使用此工具获取参考知识。
输入应当是一个具体的中文问题或关键词。`,
  func: async (query: string) => {
    const docs = await searchKnowledge(query, 5);
    if (docs.length === 0) {
      return "未找到相关知识。";
    }
    return docs
      .map(
        (doc, i) =>
          `[${i + 1}] 来源: ${doc.metadata.source}${
            doc.metadata.h2 ? ` > ${doc.metadata.h2}` : ""
          } | 领域: ${doc.metadata.domain}
${doc.pageContent.slice(0, 800)}`,
      )
      .join("\n\n---\n\n");
  },
});

/**
 * 按领域搜索工具
 */
export const domainSearchTool = new DynamicTool({
  name: "search_by_domain",
  description: `按知识领域搜索倪海厦知识库。领域范围: 黄帝内经、伤寒论、金匮要略、神农本草经、针灸、天纪、命理八字、面相学、中医临床、养生功法、方剂、医案、阴实理论、文集。
输入格式: "领域 | 查询内容"，例如 "伤寒论 | 桂枝汤" 或 "命理八字 | 正官格"
如不指定领域，请使用 search_knowledge_base。`,
  func: async (input: string) => {
    const parts = input.split("|").map((s) => s.trim());
    if (parts.length !== 2) {
      return '输入格式错误。请使用 "领域 | 查询内容" 的格式。';
    }
    const [domain, query] = parts;
    const docs = await searchByDomain(query, domain, 5);
    if (docs.length === 0) {
      return `领域 "${domain}" 中未找到相关内容。`;
    }
    return docs
      .map(
        (doc, i) =>
          `[${i + 1}] ${doc.metadata.source}${doc.metadata.h2 ? ` > ${doc.metadata.h2}` : ""}
${doc.pageContent.slice(0, 800)}`,
      )
      .join("\n\n---\n\n");
  },
});

/**
 * 查询类型分类工具
 */
export const classifyQueryTool = new DynamicTool({
  name: "classify_query",
  description: `判断用户查询属于哪个知识领域。返回: tcm_diagnosis, tcm_prescription, bazi_analysis, mianxiang_analysis, yijing_divination, health_advice, general_knowledge, unknown`,
  func: async (query: string) => {
    const type = await classifyQuery(query);
    return type;
  },
});

/**
 * 格式化检索结果供 LLM 使用
 */
export function formatRetrievedDocs(docs: KnowledgeDocument[]): string {
  if (docs.length === 0) return "未检索到相关知识。";

  return docs
    .map(
      (doc, i) =>
        `【参考 ${i + 1}】
来源: ${doc.metadata.source}
章节: ${[doc.metadata.h1, doc.metadata.h2, doc.metadata.h3].filter(Boolean).join(" > ")}
领域: ${doc.metadata.domain}

${doc.pageContent}`,
    )
    .join("\n\n");
}
