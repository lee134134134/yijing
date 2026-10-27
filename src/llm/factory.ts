/**
 * ChatModel 工厂与 provider adapter 注册表
 *
 * 业务层只关心 role(main/deep/classify/rewrite),不再直接读 baseURL/model/key。
 * 角色解析顺序:
 * 1. LLM_<ROLE>_* 专属配置
 * 2. LLM_PROVIDER / LLM_MODEL / LLM_API_KEY / LLM_BASE_URL 全局配置
 * 3. 旧配置 OPENAI_BASE_URL / OPENAI_API_KEY / LLM_MODEL(完全兼容)
 * 4. provider 预设默认值
 *
 * 网关差异(response_format / thinking)由 ProviderCapabilities 驱动,
 * 不再在 agents/deep-agent.ts 里按 baseUrl 字符串猜。
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import { config } from "../config.js";
import { ErrorCode, LLMError, YijingError } from "../errors.js";
import { createLogger } from "../logger.js";
import { detectProviderFromUrl, getProvider, normalizeProviderId } from "./providers.js";
import { LLM_ROLES, type LlmConfigView, type LlmRole, type LlmRoleStatus, type ResolvedModelConfig } from "./types.js";

const log = createLogger("llm:factory");

/** adapter:把解析后的配置变成 LangChain ChatModel */
export type ChatModelAdapter = (resolved: ResolvedModelConfig) => BaseChatModel;

const adapters = new Map<string, ChatModelAdapter>();

/** 注册自定义协议 adapter(如 anthropic-native / google-native) */
export function registerChatModelAdapter(protocol: string, adapter: ChatModelAdapter): void {
  adapters.set(protocol, adapter);
}

function createOpenAICompatibleModel(resolved: ResolvedModelConfig): BaseChatModel {
  return new ChatOpenAI({
    model: resolved.model,
    temperature: resolved.temperature,
    maxRetries: resolved.maxRetries,
    timeout: resolved.timeoutMs > 0 ? resolved.timeoutMs : undefined,
    maxTokens: resolved.maxTokens,
    modelKwargs: Object.keys(resolved.modelKwargs).length > 0 ? resolved.modelKwargs : undefined,
    configuration: {
      baseURL: resolved.baseUrl,
      // 本地 Ollama/LM Studio 不校验 key,但 OpenAI SDK 要求非空字符串
      apiKey: resolved.apiKey || "not-required",
      defaultHeaders: Object.keys(resolved.headers).length > 0 ? resolved.headers : undefined,
    },
  });
}

registerChatModelAdapter("openai-compatible", createOpenAICompatibleModel);

export interface ChatModelOverrides {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  modelKwargs?: Record<string, unknown>;
  /** 是否启用结构化 JSON 输出;deep 角色默认 true */
  structuredJson?: boolean;
}

export interface CreateChatModelOptions extends ChatModelOverrides {
  /** 默认 main */
  role?: LlmRole;
  /** 测试注入用;生产不传,默认读 config */
  config?: LlmConfigView;
}

function pickString(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function sanitizeBaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    url.username = "";
    url.password = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return baseUrl;
  }
}

function isLocalUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

/**
 * 解析某个角色的最终模型配置
 *
 * 纯函数(不创建客户端、不发请求),便于单测和状态接口复用。
 */
export function resolveModelConfig(
  role: LlmRole = "main",
  cfg: LlmConfigView = config,
  overrides: ChatModelOverrides = {},
): ResolvedModelConfig {
  const roleConfig = cfg.llmRoles?.[role] ?? {};
  const legacyBaseUrl = pickString(cfg.openaiBaseUrl);
  const explicitProvider = pickString(roleConfig.provider, cfg.llmProvider);
  const detectedProvider = detectProviderFromUrl(legacyBaseUrl);
  const providerId = normalizeProviderId(explicitProvider || detectedProvider || "openai");

  const configuredBaseUrl = pickString(roleConfig.baseUrl, cfg.llmBaseUrl);
  let provider = getProvider(providerId, cfg);
  if (!provider) {
    if (!configuredBaseUrl && !legacyBaseUrl) {
      throw new YijingError(
        ErrorCode.CONFIG_ERROR,
        `Unknown LLM provider "${providerId}". Use a built-in preset, "custom", or register it in LLM_PROVIDERS_FILE.`,
        { statusCode: 500 },
      );
    }
    // 未声明的 provider + 显式 baseUrl:按 OpenAI 兼容协议透传,免去为一个网关改代码
    provider = {
      id: providerId,
      label: providerId,
      protocol: "openai-compatible",
      baseUrl: configuredBaseUrl || legacyBaseUrl,
      defaultModel: "",
      capabilities: {
        toolCalling: true,
        jsonMode: true,
        jsonModeConflictsWithTools: false,
        disableThinkingForJson: false,
        thinking: false,
      },
    };
  }

  // 显式 provider 时以预设为准(避免残留的 OPENAI_BASE_URL 污染);
  // 未显式 provider 时保留旧配置的 baseURL,保证零迁移。
  const baseUrl = pickString(
    configuredBaseUrl,
    explicitProvider ? provider.baseUrl : legacyBaseUrl,
    provider.baseUrl,
    legacyBaseUrl,
  );

  if (!baseUrl) {
    throw new YijingError(
      ErrorCode.CONFIG_ERROR,
      `LLM base URL is empty for provider "${providerId}". Set LLM_BASE_URL or LLM_<ROLE>_BASE_URL.`,
      { statusCode: 500 },
    );
  }

  const providerKey = cfg.llmProviderKeys?.[providerId] ?? cfg.llmProviderKeys?.[provider.id];
  // 旧 OPENAI_API_KEY 只回退给 OpenAI 系/自定义网关;显式选了 DeepSeek 等厂商时
  // 绝不能把 OpenAI key 发到别家,缺 key 交给启动校验报错。
  const allowLegacyKey = !explicitProvider || ["openai", "openrouter", "custom"].includes(providerId);
  const apiKey = pickString(
    roleConfig.apiKey,
    providerKey,
    provider.apiKey,
    cfg.llmApiKey,
    allowLegacyKey ? cfg.openaiApiKey : undefined,
  );

  const model = pickString(
    overrides.model,
    roleConfig.model,
    role === "deep" ? cfg.deepModel : undefined,
    cfg.llmModel,
    provider.defaultModel,
    "gpt-4o-mini",
  );

  const temperature = overrides.temperature ?? roleConfig.temperature ?? cfg.llmTemperature ?? 0.3;
  const maxRetries = cfg.llmMaxRetries ?? 3;
  const timeoutMs = cfg.llmTimeoutMs ?? 120_000;
  const maxTokens = overrides.maxTokens ?? roleConfig.maxTokens;

  const headers: Record<string, string> = {
    ...(provider.headers ?? {}),
    ...(cfg.llmExtraHeaders ?? {}),
    ...(roleConfig.headers ?? {}),
  };

  const structuredJson = overrides.structuredJson ?? role === "deep";
  const jsonPolicy = structuredJson ? (role === "deep" ? (cfg.deepJsonMode ?? "auto") : "auto") : "off";
  const capabilityJson = provider.capabilities.jsonMode && !provider.capabilities.jsonModeConflictsWithTools;
  const jsonMode = jsonPolicy === "off" ? false : jsonPolicy === "on" ? true : capabilityJson;
  const disableThinking = jsonMode && provider.capabilities.disableThinkingForJson;

  const modelKwargs: Record<string, unknown> = {
    ...(roleConfig.modelKwargs ?? {}),
    ...(overrides.modelKwargs ?? {}),
  };
  if (jsonMode && modelKwargs.response_format === undefined) {
    modelKwargs.response_format = { type: "json_object" };
  }
  if (disableThinking && modelKwargs.thinking === undefined) {
    modelKwargs.thinking = { type: "disabled" };
  }

  return {
    role,
    providerId,
    providerLabel: provider.label,
    protocol: provider.protocol,
    model,
    baseUrl,
    apiKey,
    temperature,
    maxRetries,
    timeoutMs,
    maxTokens,
    headers,
    modelKwargs,
    capabilities: provider.capabilities,
    jsonMode,
    disableThinking,
  };
}

/**
 * 创建 Chat 模型
 *
 * 所有 LLM 调用都必须经过这里(或 rag/chain.getChatModel 包装),
 * 保证重试 / 超时 / 角色路由 / 网关差异只在一处生效。
 */
export function createChatModel(options: CreateChatModelOptions = {}): BaseChatModel {
  const role = options.role ?? "main";
  const resolved = resolveModelConfig(role, options.config ?? config, options);
  const adapter = adapters.get(resolved.protocol);
  if (!adapter) {
    throw new LLMError(
      ErrorCode.CONFIG_ERROR,
      `No chat adapter registered for protocol "${resolved.protocol}" (provider "${resolved.providerId}"). ` +
        "Register one with registerChatModelAdapter().",
    );
  }

  log.debug(
    {
      role,
      provider: resolved.providerId,
      model: resolved.model,
      baseUrl: sanitizeBaseUrl(resolved.baseUrl),
      jsonMode: resolved.jsonMode,
    },
    "Chat model created",
  );

  try {
    return adapter(resolved);
  } catch (err) {
    throw new LLMError(ErrorCode.LLM_UNAVAILABLE, `Failed to create chat model for provider "${resolved.providerId}"`, {
      cause: err,
    });
  }
}

/** 状态接口用:各角色 provider/model 摘要(不含 key) */
export function getLlmStatus(cfg: LlmConfigView = config): LlmRoleStatus[] {
  return LLM_ROLES.map((role) => {
    try {
      const resolved = resolveModelConfig(role, cfg, { structuredJson: role === "deep" });
      return {
        role,
        provider: resolved.providerId,
        model: resolved.model,
        baseUrl: sanitizeBaseUrl(resolved.baseUrl),
        jsonMode: resolved.jsonMode,
        error: resolved.apiKey || isLocalUrl(resolved.baseUrl) ? undefined : "API key not configured",
      };
    } catch (err) {
      return {
        role,
        provider: "invalid",
        model: "",
        baseUrl: "",
        jsonMode: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
}
