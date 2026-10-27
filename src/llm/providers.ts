/**
 * Provider 预设注册表
 *
 * 大部分第三方大模型(OpenRouter/DeepSeek/Kimi/Qwen/智谱/SiliconFlow/Ollama…)
 * 都提供 OpenAI 兼容接口,差异集中在 baseUrl、key 环境变量和少量请求参数上。
 * 这里把差异收敛成 preset + capabilities,业务代码只按 role 取模型。
 *
 * 新增网关:
 * - 常见网关:在 BUILTIN_PROVIDERS 加一条(或通过 LLM_PROVIDERS_FILE 外挂)
 * - 非 OpenAI 协议:实现并注册 chat adapter(见 src/llm/factory.ts)
 */

import { readFileSync } from "node:fs";
import { z } from "zod";
import { config } from "../config.js";
import { createLogger } from "../logger.js";
import type { LlmConfigView, ProviderCapabilities, ProviderPreset } from "./types.js";

const log = createLogger("llm:providers");

const DEFAULT_CAPABILITIES: ProviderCapabilities = {
  toolCalling: true,
  jsonMode: true,
  jsonModeConflictsWithTools: false,
  disableThinkingForJson: false,
  thinking: false,
};

function caps(overrides?: Partial<ProviderCapabilities>): ProviderCapabilities {
  return { ...DEFAULT_CAPABILITIES, ...overrides };
}

/**
 * 内置 provider 预设
 *
 * 默认模型仅作为「没有显式配置 LLM_MODEL 时」的兜底,不保证账号可用;
 * 生产环境请显式设置模型名。
 */
const BUILTIN_PROVIDERS: Record<string, ProviderPreset> = {
  openai: {
    id: "openai",
    label: "OpenAI",
    protocol: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    capabilities: caps(),
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    protocol: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4o-mini",
    capabilities: caps({
      // OpenRouter 上 json_object 与工具调用互斥:模型想检索时会被压成畸形 JSON
      jsonModeConflictsWithTools: true,
      thinking: true,
    }),
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    protocol: "openai-compatible",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    capabilities: caps({
      // 官方文档未承诺 json_object 与 function calling 可同时使用,默认走提示词约束
      jsonModeConflictsWithTools: true,
      thinking: true,
    }),
  },
  moonshot: {
    id: "moonshot",
    label: "Moonshot / Kimi",
    protocol: "openai-compatible",
    baseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-8k",
    capabilities: caps({ thinking: true }),
  },
  qwen: {
    id: "qwen",
    label: "阿里云百炼 / DashScope",
    protocol: "openai-compatible",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    capabilities: caps({ thinking: true }),
  },
  zhipu: {
    id: "zhipu",
    label: "智谱 GLM",
    protocol: "openai-compatible",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-plus",
    capabilities: caps({ thinking: true }),
  },
  siliconflow: {
    id: "siliconflow",
    label: "SiliconFlow",
    protocol: "openai-compatible",
    baseUrl: "https://api.siliconflow.cn/v1",
    defaultModel: "Qwen/Qwen2.5-72B-Instruct",
    capabilities: caps({ thinking: true }),
  },
  groq: {
    id: "groq",
    label: "Groq",
    protocol: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    capabilities: caps(),
  },
  ollama: {
    id: "ollama",
    label: "Ollama(本地)",
    protocol: "openai-compatible",
    baseUrl: "http://127.0.0.1:11434/v1",
    defaultModel: "qwen2.5:7b",
    capabilities: caps({
      // 本地模型对 json_object / thinking 支持因模型而异,默认走提示词约束最稳
      jsonMode: false,
      thinking: false,
    }),
  },
  lmstudio: {
    id: "lmstudio",
    label: "LM Studio(本地)",
    protocol: "openai-compatible",
    baseUrl: "http://127.0.0.1:1234/v1",
    defaultModel: "local-model",
    capabilities: caps({ jsonMode: false, thinking: false }),
  },
  opencode: {
    id: "opencode",
    label: "OpenCode Zen",
    protocol: "openai-compatible",
    baseUrl: "https://opencode.ai/zen/v1",
    defaultModel: "claude-sonnet-4-5",
    capabilities: caps({
      // zen 网关:thinking 与 json_object/tool_choice 互斥,JSON 模式需显式关闭
      disableThinkingForJson: true,
      thinking: true,
    }),
  },
  custom: {
    id: "custom",
    label: "自定义 OpenAI 兼容服务",
    protocol: "openai-compatible",
    baseUrl: "",
    defaultModel: "gpt-4o-mini",
    capabilities: caps(),
  },
};

/** provider 别名:减少用户记错 id 的成本 */
const PROVIDER_ALIASES: Record<string, string> = {
  "openai-compatible": "custom",
  dashscope: "qwen",
  aliyun: "qwen",
  bailian: "qwen",
  zhipuai: "zhipu",
  glm: "zhipu",
  kimi: "moonshot",
  zen: "opencode",
  "opencode-zen": "opencode",
};

/** 自定义 provider 文件格式 */
const capabilitySchema = z
  .object({
    toolCalling: z.boolean(),
    jsonMode: z.boolean(),
    jsonModeConflictsWithTools: z.boolean(),
    disableThinkingForJson: z.boolean(),
    thinking: z.boolean(),
  })
  .partial();

const customProviderSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).optional(),
  protocol: z.string().min(1).optional(),
  baseUrl: z.string().min(1),
  apiKey: z.string().optional(),
  defaultModel: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  capabilities: capabilitySchema.optional(),
});

const customProviderFileSchema = z.union([
  z.array(customProviderSchema),
  z.object({ providers: z.array(customProviderSchema) }),
]);

interface CustomProviderLoad {
  providers: Map<string, ProviderPreset>;
  errors: string[];
}

/** 按文件路径缓存,避免每次取模型都读盘;测试可用不同路径隔离 */
const customProviderCache = new Map<string, CustomProviderLoad>();

function toPreset(entry: z.infer<typeof customProviderSchema>): ProviderPreset {
  return {
    id: normalizeProviderId(entry.id),
    label: entry.label ?? entry.id,
    protocol: entry.protocol ?? "openai-compatible",
    baseUrl: entry.baseUrl,
    apiKey: entry.apiKey,
    defaultModel: entry.defaultModel ?? "gpt-4o-mini",
    headers: entry.headers,
    capabilities: caps(entry.capabilities),
  };
}

/**
 * 读取 LLM_PROVIDERS_FILE(可选)
 *
 * 文件不存在时不报错(未启用外挂配置);JSON 非法 / schema 不符时记录错误,
 * 由 config-validation 在启动阶段汇总后 fail fast。
 */
function loadCustomProviders(cfg: LlmConfigView = config): CustomProviderLoad {
  const filePath = cfg.llmProvidersFile?.trim();
  if (!filePath) return { providers: new Map(), errors: [] };

  const cached = customProviderCache.get(filePath);
  if (cached) return cached;

  const result: CustomProviderLoad = { providers: new Map(), errors: [] };
  try {
    const raw: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    const parsed = customProviderFileSchema.safeParse(raw);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
      result.errors.push(`LLM_PROVIDERS_FILE schema invalid: ${detail.join("; ")}`);
    } else {
      const entries = Array.isArray(parsed.data) ? parsed.data : parsed.data.providers;
      for (const entry of entries) {
        const preset = toPreset(entry);
        if (result.providers.has(preset.id)) {
          result.errors.push(`LLM_PROVIDERS_FILE has duplicate provider id "${preset.id}"`);
          continue;
        }
        result.providers.set(preset.id, preset);
      }
      log.info({ filePath, count: result.providers.size }, "Custom LLM providers loaded");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.errors.push(`LLM_PROVIDERS_FILE cannot be read: ${filePath} (${message})`);
  }

  customProviderCache.set(filePath, result);
  return result;
}

/** 规范化 provider id(小写 + 别名) */
export function normalizeProviderId(id: string): string {
  const normalized = id.trim().toLowerCase();
  return PROVIDER_ALIASES[normalized] ?? normalized;
}

/** 从 base URL 反推 provider(兼容只有 OPENAI_BASE_URL 的旧配置) */
export function detectProviderFromUrl(baseUrl: string | undefined): string | undefined {
  if (!baseUrl) return undefined;
  const patterns: Array<[RegExp, string]> = [
    [/openrouter\.ai/i, "openrouter"],
    [/api\.openai\.com/i, "openai"],
    [/api\.deepseek\.com/i, "deepseek"],
    [/dashscope\.aliyuncs\.com/i, "qwen"],
    [/open\.bigmodel\.cn/i, "zhipu"],
    [/api\.moonshot\.cn/i, "moonshot"],
    [/api\.siliconflow\.cn/i, "siliconflow"],
    [/api\.groq\.com/i, "groq"],
    [/opencode\.ai/i, "opencode"],
    [/(^|\/\/)(127\.0\.0\.1|localhost):11434/i, "ollama"],
    [/(^|\/\/)(127\.0\.0\.1|localhost):1234/i, "lmstudio"],
  ];
  for (const [pattern, providerId] of patterns) {
    if (pattern.test(baseUrl)) return providerId;
  }
  return undefined;
}

/**
 * 获取 provider 预设
 *
 * 外挂文件优先于内置预设(允许用户覆盖默认 baseUrl/能力)。
 * 未知 id 返回 undefined,由 factory 决定是走自定义 baseUrl 还是报错。
 */
export function getProvider(id: string, cfg: LlmConfigView = config): ProviderPreset | undefined {
  const normalized = normalizeProviderId(id);
  const custom = loadCustomProviders(cfg);
  return custom.providers.get(normalized) ?? BUILTIN_PROVIDERS[normalized];
}

/** 列出所有可用 preset(状态页/排查用,不含 key) */
export function listProviders(cfg: LlmConfigView = config): Array<Omit<ProviderPreset, "apiKey">> {
  const custom = loadCustomProviders(cfg);
  const merged = new Map<string, ProviderPreset>(Object.entries(BUILTIN_PROVIDERS));
  for (const [id, preset] of custom.providers) merged.set(id, preset);
  return [...merged.values()].map(({ apiKey: _apiKey, ...preset }) => preset).sort((a, b) => a.id.localeCompare(b.id));
}

/** 外挂 provider 配置错误(启动校验汇总) */
export function getProviderLoadErrors(cfg: LlmConfigView = config): string[] {
  return loadCustomProviders(cfg).errors;
}
