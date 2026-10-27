/**
 * LLM 接入层类型
 *
 * 目标:把「provider 预设 + 角色路由 + 网关能力差异」从业务代码里抽出来。
 * 新增第三方网关时,优先只加一条 preset;需要非 OpenAI 协议时再注册 adapter。
 */

/** 模型角色:不同角色可路由到不同 provider / model / key */
export const LLM_ROLES = ["main", "deep", "classify", "rewrite"] as const;
export type LlmRole = (typeof LLM_ROLES)[number];

/** 网关能力开关:驱动 JSON 输出、thinking 等请求参数的差异 */
export interface ProviderCapabilities {
  /** 支持 tool / function calling */
  toolCalling: boolean;
  /** 支持 response_format=json_object */
  jsonMode: boolean;
  /** json_object 与 tool calling 互斥(同时开启会把工具调用压成畸形 JSON) */
  jsonModeConflictsWithTools: boolean;
  /** 使用 json_object 时必须显式关闭 thinking(部分网关互斥) */
  disableThinkingForJson: boolean;
  /** 支持 thinking / reasoning 参数 */
  thinking: boolean;
}

/**
 * Provider 预设
 *
 * protocol 决定用哪个 adapter 创建 LangChain ChatModel。
 * 当前内置只有 openai-compatible;未来接 Anthropic/Gemini 原生 SDK 时
 * 注册新的 protocol adapter 即可,业务层不变。
 */
export interface ProviderPreset {
  id: string;
  label: string;
  /** adapter 协议,如 openai-compatible */
  protocol: string;
  baseUrl: string;
  /** 自定义 provider 文件内可直接写 key(优先用 providerKeys/env) */
  apiKey?: string;
  defaultModel: string;
  headers?: Record<string, string>;
  capabilities: ProviderCapabilities;
}

/** 单个角色的环境变量配置(config.ts 解析后) */
export interface RoleConfigView {
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  headers?: Record<string, string>;
  modelKwargs?: Record<string, unknown>;
}

/**
 * 配置视图(结构化子集)
 *
 * 单测可以直接传普通对象,不必 mock 整个 config 模块;
 * 生产默认值来自 config.ts。
 */
export interface LlmConfigView {
  llmProvider?: string;
  llmBaseUrl?: string;
  llmApiKey?: string;
  llmProviderKeys?: Record<string, string>;
  llmExtraHeaders?: Record<string, string>;
  llmRoles?: Partial<Record<LlmRole, RoleConfigView>>;
  llmProvidersFile?: string;
  llmConfigIssues?: string[];
  deepJsonMode?: "auto" | "on" | "off";
  llmTimeoutMs?: number;
  /** 旧配置(保持向后兼容) */
  openaiBaseUrl?: string;
  openaiApiKey?: string;
  llmModel?: string;
  deepModel?: string;
  llmTemperature?: number;
  llmMaxRetries?: number;
}

/** 解析后的完整模型配置(不含密钥输出到日志/API 的路径) */
export interface ResolvedModelConfig {
  role: LlmRole;
  providerId: string;
  providerLabel: string;
  protocol: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  temperature: number;
  maxRetries: number;
  timeoutMs: number;
  maxTokens?: number;
  headers: Record<string, string>;
  modelKwargs: Record<string, unknown>;
  capabilities: ProviderCapabilities;
  /** 本次请求是否启用 response_format=json_object */
  jsonMode: boolean;
  /** 本次请求是否显式关闭 thinking */
  disableThinking: boolean;
}

/** 状态接口暴露的模型信息(不含 key) */
export interface LlmRoleStatus {
  role: LlmRole;
  provider: string;
  model: string;
  baseUrl: string;
  jsonMode: boolean;
  error?: string;
}
