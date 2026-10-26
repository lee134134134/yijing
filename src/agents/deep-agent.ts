/**
 * DeepAgent 构建与单例管理
 *
 * 基于 langchain-ai/deepagents 的 createDeepAgent 构建中医知识库 agent,
 * 提供 buildDeepAgent() 单例,避免每次问答重复构建(冷启动优化)。
 */

import { createDeepAgent, createSubAgent, type DeepAgent, registerHarnessProfile, type SubAgent } from "deepagents";
import type { ReactAgent } from "langchain";
import { todoListMiddleware } from "langchain";
import { z } from "zod";
import { config } from "../config.js";
import { getChatModel } from "../rag/chain.js";
import { DEEP_ANALYST_PROMPT, DEEP_SYSTEM_PROMPT } from "./prompts.js";
import { allTools } from "./tools.js";

/** 内置文件系统工具名(与 deepagents FILESYSTEM_TOOL_NAMES 一致) */
const FILESYSTEM_TOOL_NAMES = ["ls", "read_file", "write_file", "edit_file", "glob", "grep", "execute"];

/**
 * 注册 harness profile,从模型可见工具集中隐藏全部文件系统工具(D1)。
 *
 * deepagents 按 model spec 解析 profile: 优先 `${provider}:${model}`,
 * 回退到 `${model}`、`${provider}`。因此为当前模型名注册即可生效。
 */
function registerD1Profile() {
  for (const modelName of new Set([config.llmModel, config.deepModel])) {
    registerHarnessProfile(modelName, {
      excludedTools: FILESYSTEM_TOOL_NAMES,
    });
    // 同时注册 provider:model 形式,确保模型名为纯自定义值时也能命中
    registerHarnessProfile(`openai:${modelName}`, {
      excludedTools: FILESYSTEM_TOOL_NAMES,
    });
  }
}

/** deep_analyst 结构化输出 schema(对应 types.AnalysisResult) */
export const DEEP_ANALYST_RESPONSE_SCHEMA = z.object({
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

/**
 * deep_analyst subagent(D4): /deep 深度分析
 *
 * 延迟到构建 agent 时才创建模型:配置非法时应由 config-validation 给出可读错误,
 * 而不是在模块 import 阶段直接抛栈。网关差异由 provider capabilities 驱动。
 */
function buildDeepAnalystSubAgent(): SubAgent {
  return {
    name: "deep_analyst",
    description: "对复杂的中医/命理/养生问题进行深度多角度分析,输出结构化 JSON 结论。当用户请求深度分析时使用。",
    systemPrompt: DEEP_ANALYST_PROMPT,
    tools: [...allTools],
    model: getChatModel({ role: "deep", structuredJson: true }),
    middleware: config.enableTodoPlanning ? [todoListMiddleware()] : [],
  };
}

let agentInstance: DeepAgent | null = null;

/**
 * 构建 DeepAgent(单例)
 *
 * - model: 按 main 角色解析的 ChatModel(provider/baseURL/key 见 src/llm/)
 * - middleware: todoListMiddleware(D3 任务规划)
 * - subagents: deep_analyst(D4)
 * - 文件系统工具经 harness profile 隐藏(D1),且默认 StateBackend 为内存态,
 *   双重保障 agent 无法读写服务器文件
 */
export function buildDeepAgent(): DeepAgent {
  if (agentInstance) return agentInstance;

  registerD1Profile();

  const model = getChatModel({ role: "main" });

  agentInstance = createDeepAgent({
    name: "yijing-deep-agent",
    model,
    systemPrompt: DEEP_SYSTEM_PROMPT,
    tools: [...allTools],
    middleware: config.enableTodoPlanning ? [todoListMiddleware()] : [],
    subagents: [buildDeepAnalystSubAgent()],
  });

  return agentInstance;
}

let analystInstance: ReactAgent | null = null;

/**
 * 构建独立 deep_analyst agent(单例)
 *
 * /deep 深度分析不经过主 agent 的任务分配,而是直接调用编译后的
 * deep_analyst ReactAgent。其模型使用 deep 角色的 JSON 输出策略,最终消息为
 * JSON 文本,由 deepDeepAnalysis 手动解析为 DEEP_ANALYST_RESPONSE_SCHEMA。
 */
export function buildDeepAnalystAgent(): ReactAgent {
  if (analystInstance) return analystInstance;

  registerD1Profile();

  analystInstance = createSubAgent(buildDeepAnalystSubAgent());

  return analystInstance;
}

/** 测试/热重载用:重置单例 */
export function resetDeepAgent(): void {
  agentInstance = null;
  analystInstance = null;
}
