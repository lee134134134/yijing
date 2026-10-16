/**
 * 配置验证模块
 *
 * 服务启动时验证所有必需配置，确保不会因为配置错误而静默失败。
 */

import { config } from "./config.js";
import { ErrorCode, YijingError } from "./errors.js";
import { createLogger } from "./logger.js";

const log = createLogger("config:validation");

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
  if (!config.openaiApiKey) {
    errors.push("OPENAI_API_KEY is required but not configured");
  }

  if (!config.openaiBaseUrl || config.openaiBaseUrl === "https://api.openai.com/v1") {
    warnings.push("Using default OpenAI base URL - consider setting OPENAI_BASE_URL");
  }

  if (!config.llmModel) {
    errors.push("LLM_MODEL is required");
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
