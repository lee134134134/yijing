/**
 * 配置验证模块
 *
 * 服务启动时验证所有必需配置，确保不会因为配置错误而静默失败。
 */

import { config } from "./config.js";
import { ErrorCode, YijingError } from "./errors.js";
import { resolveModelConfig } from "./llm/factory.js";
import { getProviderLoadErrors } from "./llm/providers.js";
import { LLM_ROLES } from "./llm/types.js";
import { createLogger } from "./logger.js";

const log = createLogger("config:validation");

/** 本机/内网模型服务通常不校验 API Key */
function isLocalBaseUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

/** 验证结果 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * 验证运行时配置
 * 在服务启动前调用，确保所有必需配置正确
 */
export function validateConfig(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ── LLM 配置验证 ──
  if (!config.llmModel) {
    errors.push("LLM_MODEL is required");
  }

  for (const issue of config.llmConfigIssues ?? []) {
    errors.push(issue);
  }
  for (const issue of getProviderLoadErrors(config)) {
    errors.push(issue);
  }

  // 按角色校验:每个角色最终解析出的 provider/baseURL/key 都必须可用
  for (const role of LLM_ROLES) {
    try {
      const resolved = resolveModelConfig(role, config);
      if (!/^https?:\/\//i.test(resolved.baseUrl)) {
        errors.push(`LLM role "${role}" base URL must start with http:// or https:// (got "${resolved.baseUrl}")`);
      }
      const hasAuthHeader = Object.keys(resolved.headers).some((name) =>
        /^(authorization|api[-_]?key|x-api-key)$/i.test(name),
      );
      if (!resolved.apiKey && !hasAuthHeader && !isLocalBaseUrl(resolved.baseUrl)) {
        errors.push(
          `LLM role "${role}" (provider "${resolved.providerId}") has no API key. ` +
            `Set LLM_<ROLE>_API_KEY, ${resolved.providerId.toUpperCase()}_API_KEY, or LLM_PROVIDER_KEYS.`,
        );
      }
      if (!Number.isFinite(resolved.temperature) || resolved.temperature < 0 || resolved.temperature > 2) {
        errors.push(`LLM role "${role}" temperature must be between 0 and 2`);
      }
      if (!Number.isInteger(resolved.maxRetries) || resolved.maxRetries < 0 || resolved.maxRetries > 10) {
        errors.push(`LLM role "${role}" maxRetries must be an integer between 0 and 10`);
      }
      if (!Number.isFinite(resolved.timeoutMs) || resolved.timeoutMs < 0) {
        errors.push(`LLM role "${role}" timeout must be >= 0`);
      }
      if (resolved.maxTokens !== undefined && (!Number.isInteger(resolved.maxTokens) || resolved.maxTokens <= 0)) {
        errors.push(`LLM role "${role}" maxTokens must be a positive integer`);
      }
    } catch (err) {
      errors.push(`LLM role "${role}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── ChromaDB 配置验证 ──
  if (!config.chromaDbUrl) {
    errors.push("CHROMA_DB_URL is required");
  }

  // ── 嵌入模型验证 ──
  if (!config.embeddingModel) {
    errors.push("EMBEDDING_MODEL is required");
  }

  // ── 检索参数验证 ──
  if (config.retrievalTopK < 1 || config.retrievalTopK > 50) {
    errors.push(`RETRIEVAL_TOP_K (${config.retrievalTopK}) must be between 1 and 50`);
  }

  if (config.chunkSize < 100 || config.chunkSize > 5000) {
    errors.push(`CHUNK_SIZE (${config.chunkSize}) must be between 100 and 5000`);
  }

  // ── API 配置验证 ──
  if (config.apiPort < 1 || config.apiPort > 65535) {
    errors.push(`API_PORT (${config.apiPort}) must be between 1 and 65535`);
  }

  // ── 日志配置验证 ──
  const validLogLevels = ["fatal", "error", "warn", "info", "debug", "trace"];
  if (!validLogLevels.includes(config.logLevel)) {
    errors.push(`LOG_LEVEL (${config.logLevel}) must be one of: ${validLogLevels.join(", ")}`);
  }

  // ── 深度分析配置验证 ──
  if (config.deepAgentMaxIterations < 1 || config.deepAgentMaxIterations > 100) {
    errors.push(`DEEP_AGENT_MAX_ITERATIONS (${config.deepAgentMaxIterations}) must be between 1 and 100`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * 启动时验证配置，如果失败则抛出错误
 */
export function assertConfig(): void {
  const result = validateConfig();

  if (result.warnings.length > 0) {
    for (const warning of result.warnings) {
      log.warn(warning);
    }
  }

  if (!result.valid) {
    const errorMsg = `Configuration validation failed:\n${result.errors.map((e) => `  - ${e}`).join("\n")}`;
    log.error(errorMsg);
    throw new YijingError(ErrorCode.CONFIG_ERROR, errorMsg, { statusCode: 500 });
  }

  log.info("Configuration validated successfully");
}
