/**
 * LLM 接入层对外出口
 *
 * 业务代码优先从 `src/llm/index.js` 引入;`rag/chain.ts` 的 getChatModel
 * 仅作为历史兼容包装保留。
 */

export type { ChatModelAdapter, ChatModelOverrides, CreateChatModelOptions } from "./factory.js";
export { createChatModel, getLlmStatus, registerChatModelAdapter, resolveModelConfig } from "./factory.js";
export { detectProviderFromUrl, getProvider, listProviders, normalizeProviderId } from "./providers.js";
export type {
  LlmConfigView,
  LlmRole,
  LlmRoleStatus,
  ProviderCapabilities,
  ProviderPreset,
  ResolvedModelConfig,
  RoleConfigView,
} from "./types.js";
export { LLM_ROLES } from "./types.js";
