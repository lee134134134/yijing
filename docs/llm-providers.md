# 第三方大模型接入设计

## 为什么需要这一层

改造前,模型配置只有三个平铺变量:

```
OPENAI_BASE_URL + OPENAI_API_KEY + LLM_MODEL
```

随着网关变多,问题集中爆发:

- 不同网关的能力不同:OpenRouter 的 `json_object` 与工具调用互斥;OpenCode Zen 的 `thinking` 与 JSON 模式互斥;本地 Ollama 不支持部分参数。
- 不同角色想用不同模型:主 Agent 用便宜模型,`/deep` 用强推理模型,分类/重写用更小模型。
- 每个厂商的 key 环境变量不同,继续堆 `if (baseUrl.includes(...))` 不可维护。
- 新增一个 OpenAI 兼容网关需要改业务代码。

`src/llm/` 把这些差异收敛为三层:

```
ProviderPreset(协议/baseURL/key/默认模型/能力)
        ↓
resolveModelConfig(role)  ← LLM_PROVIDER / LLM_<ROLE>_* / 旧 OPENAI_* 优先级
        ↓
ChatModelAdapter(protocol) → ChatOpenAI / 未来 ChatAnthropic / ChatGoogle…
```

业务层只按角色取模型:`getChatModel({ role: "deep" })`。

## 目录

```
src/llm/
  types.ts      角色、ProviderCapabilities、解析后配置类型
  providers.ts  内置预设 + 外挂 LLM_PROVIDERS_FILE + URL 自动识别
  factory.ts    配置解析、adapter 注册、ChatOpenAI 构造、状态摘要
  index.ts      对外出口
```

`src/rag/chain.ts` 的 `getChatModel` 保留为历史包装,内部委托 `factory.createChatModel`。

## 解析优先级

以角色 `deep` 为例(其余角色把 `DEEP` 换成 `MAIN` / `CLASSIFY` / `REWRITE`):

| 配置项 | 优先级(高 → 低) |
|--------|------------------|
| provider | `LLM_DEEP_PROVIDER` → `LLM_PROVIDER` → 由 `OPENAI_BASE_URL` 自动识别 → `openai` |
| base URL | `LLM_DEEP_BASE_URL` → `LLM_BASE_URL` → 显式 provider 的预设 → 旧 `OPENAI_BASE_URL` → 预设 |
| API key | `LLM_DEEP_API_KEY` → `LLM_PROVIDER_KEYS[provider]` → 厂商专属变量 → `LLM_API_KEY` → 旧 `OPENAI_API_KEY`(仅 OpenAI 系/自定义网关) |
| 模型 | `LLM_DEEP_MODEL` → `DEEP_MODEL`(旧) → `LLM_MODEL` → 预设默认 |
| 温度 | `LLM_DEEP_TEMPERATURE` → `LLM_TEMPERATURE` → `0.3` |
| max tokens | `LLM_DEEP_MAX_TOKENS` → 不设置(交给模型默认) |
| 重试 | `LLM_MAX_RETRIES` → `3` |
| 超时 | `LLM_TIMEOUT_MS` → `120000` |
| 请求头 | provider 预设 → `LLM_EXTRA_HEADERS` → `LLM_DEEP_EXTRA_HEADERS` |
| modelKwargs | `LLM_DEEP_MODEL_KWARGS` → 调用方覆盖 → 能力推导(response_format/thinking) |

> `OPENAI_API_KEY` 只回退给 `openai` / `openrouter` / `custom`,避免显式选 DeepSeek 时把 OpenAI key 发到别家。缺 key 会在启动校验阶段直接报错。

## 能力开关

```ts
interface ProviderCapabilities {
  toolCalling: boolean;                 // 支持函数调用
  jsonMode: boolean;                    // 支持 response_format=json_object
  jsonModeConflictsWithTools: boolean;  // JSON 与工具调用互斥 → deep 自动关闭 JSON
  disableThinkingForJson: boolean;      // JSON 模式需显式 thinking:disabled
  thinking: boolean;                    // 支持 thinking/reasoning 参数
}
```

`deep` 角色的 JSON 策略:

| `LLM_DEEP_JSON_MODE` | 行为 |
|----------------------|------|
| `auto`(默认) | 支持 JSON 且不与工具调用冲突时启用;否则退回提示词约束 + zod 容错解析 |
| `on` | 强制 `response_format=json_object`(不兼容的模型可能报错) |
| `off` | 永不发送 `response_format` |

`disableThinkingForJson` 为 true 时,启用 JSON 会同时注入 `thinking: { type: "disabled" }`。

## 新增 OpenAI 兼容网关

### 方式一:一次性 custom

```ini
LLM_PROVIDER=custom
LLM_BASE_URL=https://llm.example.com/v1
LLM_MODEL=qwen3-72b
LLM_API_KEY=sk-...
```

### 方式二:外挂 provider 文件

`config/llm-providers.json`:

```json
{
  "providers": [
    {
      "id": "company-gateway",
      "label": "公司内部网关",
      "baseUrl": "https://llm.example.com/v1",
      "defaultModel": "qwen3-72b",
      "headers": { "X-Tenant": "yijing" },
      "capabilities": {
        "jsonMode": true,
        "jsonModeConflictsWithTools": true
      }
    }
  ]
}
```

```ini
LLM_PROVIDERS_FILE=./config/llm-providers.json
LLM_PROVIDER=company-gateway
LLM_PROVIDER_KEYS={"company-gateway":"sk-..."}
LLM_MODEL=qwen3-72b
```

- 文件中的 `id` 会覆盖同名内置预设。
- `apiKey` 可以写在文件里,但更推荐 `LLM_PROVIDER_KEYS` 或环境变量,避免密钥进 git。
- JSON 非法 / schema 不符会在启动校验阶段汇总报错。

## 新增非 OpenAI 原生协议

实现 adapter 并注册,业务层无需改动:

```ts
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { registerChatModelAdapter } from "./llm/factory.js";

registerChatModelAdapter("anthropic-native", (resolved): BaseChatModel => {
  // 需要先安装 @langchain/anthropic
  // return new ChatAnthropic({ ... });
  throw new Error("install @langchain/anthropic first");
});
```

然后在外挂 provider 文件里写 `"protocol": "anthropic-native"`。

> deepagents 的 harness profile 通过模型实例的 provider/identifier 反查;内置 OpenAI 兼容 adapter 的 provider hint 是 `openai`,所以 `deep-agent.ts` 只需注册裸模型名与 `openai:<model>`,与具体网关无关。

## 状态与排查

`GET /api/status` 新增 `llm` 数组:

```json
{
  "llm": [
    { "role": "main", "provider": "openrouter", "model": "openai/gpt-4o-mini", "baseUrl": "https://openrouter.ai/api/v1", "jsonMode": false },
    { "role": "deep", "provider": "deepseek", "model": "deepseek-chat", "baseUrl": "https://api.deepseek.com", "jsonMode": false }
  ]
}
```

只输出 provider/model/baseURL/能力,不输出任何 key。

## 接入检查清单

1. 设置 `LLM_PROVIDER` 与对应厂商 key,或保留旧 `OPENAI_*` 配置。
2. `npm run typecheck && npm test`。
3. 启动服务:`npm run server`,确认启动校验通过。
4. `GET /api/status` 确认四个角色的 provider/model 符合预期。
5. 跑一次普通问答 + `/deep`,确认工具调用与 JSON 输出正常。
6. 换 embedding provider/model 时仍须重新 `npm run ingest`(与本层无关,但同样影响检索)。
