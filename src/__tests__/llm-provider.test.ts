/**
 * 第三方 LLM 接入层单测
 *
 * 覆盖 provider 预设/自动识别/角色路由/能力差异,以及 ChatOpenAI 构造参数接线。
 * 不发任何网络请求:ChatOpenAI 边界被 mock,配置解析为纯函数。
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const captured: Array<Record<string, unknown>> = [];

vi.mock("@langchain/openai", () => ({
  ChatOpenAI: vi.fn(function (this: unknown, params: Record<string, unknown>) {
    Object.assign(this as object, params);
    captured.push(params);
  }),
}));

import { createChatModel, getLlmStatus, resolveModelConfig } from "../llm/factory.js";
import { detectProviderFromUrl, getProvider, getProviderLoadErrors, listProviders } from "../llm/providers.js";

const tempDirs: string[] = [];

function tempProviderFile(content: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "yijing-llm-"));
  tempDirs.push(dir);
  const file = join(dir, "providers.json");
  writeFileSync(file, JSON.stringify(content), "utf8");
  return file;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe("llm/providers", () => {
  it("从旧 OPENAI_BASE_URL 自动识别 provider", () => {
    expect(detectProviderFromUrl("https://openrouter.ai/api/v1")).toBe("openrouter");
    expect(detectProviderFromUrl("https://api.deepseek.com/v1")).toBe("deepseek");
    expect(detectProviderFromUrl("http://127.0.0.1:11434/v1")).toBe("ollama");
    expect(detectProviderFromUrl("https://unknown.example.com/v1")).toBeUndefined();
  });

  it("内置预设包含常见第三方网关", () => {
    const ids = listProviders().map((provider) => provider.id);
    for (const id of [
      "openai",
      "openrouter",
      "deepseek",
      "moonshot",
      "qwen",
      "zhipu",
      "siliconflow",
      "groq",
      "ollama",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("从外挂文件加载并覆盖/新增 provider", () => {
    const file = tempProviderFile({
      providers: [
        {
          id: "acme",
          label: "ACME 内部网关",
          baseUrl: "https://llm.acme.example/v1",
          defaultModel: "acme-chat-1",
          headers: { "X-Tenant": "yijing" },
          capabilities: { jsonMode: false },
        },
      ],
    });
    const cfg = { llmProvidersFile: file };

    expect(getProviderLoadErrors(cfg)).toEqual([]);
    const provider = getProvider("acme", cfg);
    expect(provider).toMatchObject({
      id: "acme",
      baseUrl: "https://llm.acme.example/v1",
      defaultModel: "acme-chat-1",
      headers: { "X-Tenant": "yijing" },
    });
    expect(provider?.capabilities.jsonMode).toBe(false);

    const resolved = resolveModelConfig("main", {
      llmProvidersFile: file,
      llmProvider: "acme",
      llmProviderKeys: { acme: "sk-acme" },
    });
    expect(resolved.model).toBe("acme-chat-1");
    expect(resolved.headers["X-Tenant"]).toBe("yijing");
    expect(resolved.apiKey).toBe("sk-acme");
  });

  it("外挂文件非法时返回可汇总的错误", () => {
    const file = tempProviderFile({ providers: [{ id: "broken" }] });
    const errors = getProviderLoadErrors({ llmProvidersFile: file });
    expect(errors.join("\n")).toContain("LLM_PROVIDERS_FILE schema invalid");
  });
});

describe("llm/factory resolveModelConfig", () => {
  const legacyConfig = {
    openaiBaseUrl: "https://openrouter.ai/api/v1",
    openaiApiKey: "sk-legacy",
    llmModel: "nvidia/nemotron:free",
    deepModel: "nvidia/nemotron:free",
    llmTemperature: 0.3,
    llmMaxRetries: 2,
  };

  it("零迁移兼容旧 OPENAI_BASE_URL / OPENAI_API_KEY 配置", () => {
    const main = resolveModelConfig("main", legacyConfig);
    expect(main).toMatchObject({
      providerId: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "sk-legacy",
      model: "nvidia/nemotron:free",
      temperature: 0.3,
      maxRetries: 2,
    });
    // OpenRouter 上 json_object 与工具调用互斥,deep 角色自动关闭,走提示词约束
    expect(resolveModelConfig("deep", legacyConfig).jsonMode).toBe(false);
  });

  it("显式 provider 使用预设 baseURL 与专属 key", () => {
    const resolved = resolveModelConfig("main", {
      llmProvider: "deepseek",
      llmProviderKeys: { deepseek: "sk-ds" },
      llmModel: "deepseek-chat",
    });
    expect(resolved).toMatchObject({
      providerId: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "sk-ds",
      model: "deepseek-chat",
    });
  });

  it("显式第三方 provider 不会误用旧 OPENAI_API_KEY", () => {
    const resolved = resolveModelConfig("main", {
      llmProvider: "deepseek",
      openaiApiKey: "sk-openai-legacy",
      llmModel: "deepseek-chat",
    });
    expect(resolved.apiKey).toBe("");
  });

  it("角色级覆盖可把 deep 路由到另一个 provider,并按能力关闭 thinking", () => {
    const resolved = resolveModelConfig("deep", {
      llmProvider: "openrouter",
      llmProviderKeys: { openrouter: "sk-or", opencode: "sk-zen" },
      llmModel: "openai/gpt-4o-mini",
      llmRoles: {
        deep: { provider: "zen", model: "big-model", temperature: 0.1, maxTokens: 4096 },
      },
      llmTimeoutMs: 5000,
    });

    expect(resolved).toMatchObject({
      providerId: "opencode",
      baseUrl: "https://opencode.ai/zen/v1",
      apiKey: "sk-zen",
      model: "big-model",
      temperature: 0.1,
      maxTokens: 4096,
      timeoutMs: 5000,
      jsonMode: true,
      disableThinking: true,
    });
    expect(resolved.modelKwargs).toEqual({
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
    });
  });

  it("baseURL / headers / modelKwargs 按 全局→角色→调用方 合并", () => {
    const resolved = resolveModelConfig(
      "main",
      {
        llmProvider: "custom",
        llmBaseUrl: "https://gateway.example.com/v1",
        llmApiKey: "global-key",
        llmExtraHeaders: { "X-Global": "1" },
        llmRoles: {
          main: {
            model: "role-model",
            headers: { "X-Role": "2" },
            modelKwargs: { top_p: 0.9 },
          },
        },
      },
      { model: "override-model", modelKwargs: { seed: 1 } },
    );

    expect(resolved.baseUrl).toBe("https://gateway.example.com/v1");
    expect(resolved.apiKey).toBe("global-key");
    expect(resolved.model).toBe("override-model");
    expect(resolved.headers).toEqual({ "X-Global": "1", "X-Role": "2" });
    expect(resolved.modelKwargs).toEqual({ top_p: 0.9, seed: 1 });
  });

  it("未声明的 provider 可凭显式 baseURL 直接接入;没有 baseURL 则报错", () => {
    const resolved = resolveModelConfig("main", {
      llmProvider: "acme-gateway",
      llmBaseUrl: "https://acme.example/v1",
      llmApiKey: "sk-acme",
      llmModel: "acme-chat",
    });
    expect(resolved.providerId).toBe("acme-gateway");
    expect(resolved.protocol).toBe("openai-compatible");

    expect(() => resolveModelConfig("main", { llmProvider: "missing" })).toThrow(/Unknown LLM provider/);
  });

  it("LLM_DEEP_JSON_MODE 可强制开启/关闭 JSON 模式", () => {
    expect(
      resolveModelConfig("deep", {
        llmProvider: "openrouter",
        llmModel: "openai/gpt-4o-mini",
        deepJsonMode: "on",
      }).jsonMode,
    ).toBe(true);
    expect(
      resolveModelConfig("deep", {
        llmProvider: "opencode",
        llmModel: "claude-sonnet-4-5",
        deepJsonMode: "off",
      }).jsonMode,
    ).toBe(false);
  });
});

describe("llm/factory createChatModel", () => {
  it("把重试/超时/headers/JSON 模式接到 ChatOpenAI", () => {
    captured.length = 0;
    createChatModel({
      role: "deep",
      config: {
        llmProvider: "deepseek",
        llmProviderKeys: { deepseek: "sk-ds" },
        llmModel: "deepseek-chat",
        llmTemperature: 0.2,
        llmMaxRetries: 4,
        llmTimeoutMs: 1234,
        deepJsonMode: "on",
      },
    });

    expect(captured[0]).toMatchObject({
      model: "deepseek-chat",
      temperature: 0.2,
      maxRetries: 4,
      timeout: 1234,
    });
    expect(captured[0]?.configuration).toMatchObject({
      baseURL: "https://api.deepseek.com/v1",
      apiKey: "sk-ds",
    });
    expect(captured[0]?.modelKwargs).toEqual({ response_format: { type: "json_object" } });
  });

  it("本地模型无 key 时使用占位 key,避免 OpenAI SDK 启动报错", () => {
    captured.length = 0;
    createChatModel({
      role: "main",
      config: { llmProvider: "ollama", llmModel: "qwen2.5:7b" },
    });
    expect(captured[0]?.configuration).toMatchObject({ apiKey: "not-required" });
  });
});

describe("llm/factory getLlmStatus", () => {
  it("输出各角色路由且不泄露密钥", () => {
    const status = getLlmStatus({
      llmProvider: "deepseek",
      llmModel: "deepseek-chat",
      llmProviderKeys: { deepseek: "sk-secret-value" },
    });
    const main = status.find((item) => item.role === "main");
    expect(main).toMatchObject({ provider: "deepseek", model: "deepseek-chat" });
    expect(main?.error).toBeUndefined();
    expect(JSON.stringify(status)).not.toContain("sk-secret-value");
  });
});
