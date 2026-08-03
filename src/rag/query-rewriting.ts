/**
 * LLM 查询重写
 *
 * Phase 2: 查询优化
 * - 将用户口语化/模糊的自然语言重写为检索友好的表述
 * - 多查询扩展：生成多个不同角度的子查询
 * - 领域术语注入：根据查询类型补充相关术语
 */

import { StringOutputParser } from "@langchain/core/output_parsers";
import { PromptTemplate } from "@langchain/core/prompts";
import { createLogger } from "../logger.js";
import { getChatModel } from "./chain.js";

const log = createLogger("rag:query-rewriting");

// ========================================
// 重写 Prompt
// ========================================

const DOMAIN_HINT: Record<string, string> = {
  tcm_diagnosis: "中医辨证（六经辨证、八纲辨证、脏腑辨证）",
  tcm_prescription: "方剂药物（组成、配伍、主治、剂量）",
  bazi_analysis: "命理八字（十神、五行生克、格局、大运）",
  mianxiang_analysis: "面相分析（五官相理、气色、纹路）",
  yijing_divination: "易经占卜（卦象、爻辞、变卦）",
  health_advice: "养生功法（四季养生、八段锦、饮食调养）",
  general_knowledge: "中医命理基础概念",
};

const REWRITE_PROMPT = PromptTemplate.fromTemplate(`
你是一位中医知识库检索专家。你的任务是将用户的自然语言问题重写为**最适合向量检索**的形式。

## 查询领域
{domain_hint}

## 重写规则
1. **提取核心概念**：去除口语化表达（"我想知道…"、"请问…"、"有没有…"），只保留关键实体和关系
2. **补充领域术语**：如用户只说"感冒了怎么办"，补充中医术语（伤寒、风寒、风热、桂枝汤、麻黄汤等）
3. **保持原意**：不要改变用户问题的核心查询意图
4. **多角度覆盖**：如果问题涉及多个方面，生成至多 {num_queries} 个独立的子查询，每行一个
5. **语言**：用中文输出，每行一个查询，不要编号，不要多余文字

## 示例
用户: 我最近总是睡不好，容易醒，该怎么办？
输出:
失眠中医辨证治疗
多梦易醒中医调理方法
不寐证针灸取穴

用户: 桂枝汤能治什么病？
输出:
桂枝汤方证主治
桂枝汤伤寒论条文
桂枝汤组成配伍功效

## 当前问题
{question}
`);

// ========================================
// 类型定义
// ========================================

export interface RewriteResult {
  /** 主查询 — 最接近用户意图的优化版本 */
  primary: string;
  /** 扩展查询 — 其他角度的子查询（可能为空） */
  alternatives: string[];
  /** 所有查询（primary + alternatives），去重 */
  all: string[];
}

// ========================================
// 实现
// ========================================

/**
 * 使用 LLM 重写用户查询，生成检索友好的版本
 *
 * @param question - 用户原始问题
 * @param numQueries - 生成查询数量（包括主查询）
 * @returns 重写后的查询集合
 */
export async function rewriteQuery(
  question: string,
  numQueries: number = 3,
  queryType?: string,
): Promise<RewriteResult> {
  try {
    const llm = getChatModel();
    const chain = REWRITE_PROMPT.pipe(llm).pipe(new StringOutputParser());
    const domainHint = (queryType && DOMAIN_HINT[queryType]) || "中医命理相关";
    const result = await chain.invoke({
      question,
      num_queries: Math.max(1, numQueries),
      domain_hint: domainHint,
    });

    const lines = result
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 2 && !l.startsWith("输出") && !l.startsWith("用户"));

    if (lines.length === 0) {
      // LLM 没吐出来，用原查询兜底
      return { primary: question, alternatives: [], all: [question] };
    }

    const primary = lines[0]!;
    const alternatives = lines.slice(1);
    const all = [primary, ...alternatives.filter((a) => a !== primary)];

    log.debug({ original: question, rewritten: all }, "Query rewritten");

    return { primary, alternatives, all };
  } catch (err) {
    log.error({ err, question }, "Query rewriting failed, using original");
    return { primary: question, alternatives: [], all: [question] };
  }
}

/**
 * 轻量级查询清理（不调用 LLM，只做规则清理）
 *
 * 适用于不需要 LLM 重写的场景，仅去除口语化前缀。
 */
export function cleanQuery(question: string): string {
  return question
    .replace(/^(请问|我想知道|我想问|你好|您好|帮我|能不能告诉我|可以告诉我|有没有|怎么|如何|为什么)\s*/i, "")
    .replace(/[？?]+$/, "")
    .trim();
}
