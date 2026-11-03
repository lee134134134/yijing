# 倪海厦知识库 - Agentic RAG

基于倪海厦人纪/天纪系列知识库的 Agentic RAG（检索增强生成）系统，使用 DeepAgent.js 多智能体框架（LangChain 1.x）实现。提供 Web、CLI、TUI、REST API 多种交互方式。

> **Node 版本要求**：Node ≥ 24（LTS；`.nvmrc`、`package.json` engines、Dockerfile 统一）

## 快速开始

```bash
# 安装依赖
npm install

# 构建知识库索引（摘要 + 全文语料 + FTS5）
npm run ingest

# 启动 Web（构建产物 + API 同一进程）
npm run build:web
npm run server
# 浏览器打开 http://127.0.0.1:3001

# 启动交互式 CLI（readline）
npm run dev

# 启动全屏终端 TUI（vue-termui 实现）
npm run build:tui
npm run tui

# 单次查询
npx tsx src/index.ts "桂枝汤的组成和适应症是什么？"
```

## 配置

编辑 `.env` 文件或设置环境变量：

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI 兼容 API 地址 |
| `OPENAI_API_KEY` | - | API Key（必填） |
| `LLM_MODEL` | `gpt-4o-mini` | 对话/分析模型名称 |
| `LLM_TEMPERATURE` | `0.3` | LLM 温度参数 |
| `LLM_MAX_RETRIES` | `3` | LLM 调用最大重试次数 |
| `LLM_RETRY_BASE_DELAY` | `2000` | 重试基础延迟（ms） |
| `CHUNK_SIZE` | `800` | 文本分块大小（字符数） |
| `CHUNK_OVERLAP` | `150` | 分块重叠（字符数） |
| `RETRIEVAL_TOP_K` | `5` | 每次检索返回的文档数 |
| `MIN_SCORE` | `0.35` | 向量检索最低相似度（0–1），低于阈值丢弃 |
| `ENABLE_HYBRID` | `true` | dense + BM25（FTS5）混合检索 |
| `EMBEDDING_PROVIDER` | `local` | Embedding 提供方：`local`（本地模型，离线可用）/ `api`（OpenAI 兼容 API） |
| `EMBEDDING_MODEL` | `Xenova/bge-small-zh-v1.5` | Embedding 模型（`api` 时默认 `text-embedding-3-small`） |
| `EMBEDDING_DIMENSION` | `512` | 向量维度（`api` 时默认 `1536`） |
| `EMBEDDING_BASE_URL` | 复用 `OPENAI_BASE_URL` | 独立 Embedding API 地址（仅 `provider=api` 生效） |
| `EMBEDDING_API_KEY` | 复用 `OPENAI_API_KEY` | 独立 Embedding API Key（仅 `provider=api` 生效） |
| `EMBEDDING_CACHE_DIR` | `./data/models` | 本地模型缓存目录（Docker 构建期预下载至 `/app/model-cache`） |
| `HF_MIRROR` | `https://hf-mirror.com/` | HuggingFace 镜像源 |
| `CHROMA_DB_URL` | `http://127.0.0.1:8000` | ChromaDB 服务地址 |
| `CHROMA_COLLECTION_NAME` | `yijing_knowledge` | ChromaDB 集合名称 |
| `MAX_BODY_SIZE` | `10485760` | 最大请求体大小（字节） |
| `RATE_LIMIT_MAX` | `100` | 每分钟最大请求数（未认证） |
| `RATE_LIMIT_AUTH_MAX` | `1000` | 每分钟最大请求数（已认证） |
| `API_KEYS` | - | API 密钥列表（逗号分隔，启用认证） |
| `MAX_HISTORY` | `200` | 对话历史最大保留条数 |
| `KNOWLEDGE_DIR` | `./memory` | 知识库 Markdown 目录（curated 摘要层） |
| `CORPUS_DIR` | `./corpus` | 全文语料目录（pdf2md 产出） |
| `INCLUDE_PRIVATE` | `false` | 是否索引家谱等 PII（默认关闭） |
| `REQUEST_TIMEOUT_MS` | `120000` | 单次请求总超时；到点 abort agent |
| `MAX_TOOL_CALLS` | `6` | 单次请求最多检索次数（成本闸门） |

> 切换 `EMBEDDING_PROVIDER`（local ↔ api）或更换 `EMBEDDING_MODEL` 会改变向量语义/维度，必须重新执行 `npm run ingest`。
> 默认使用 `Xenova/bge-small-zh-v1.5`（512 维，中文语义区分度显著优于英文模型）；索引清单会校验模型/维度/分块参数，不一致时直接报错而不是静默返回空结果。

## 第三方大模型接入

LLM 接入层位于 `src/llm/`，把「provider 预设 + 角色路由 + 网关能力差异」从业务代码中抽离。旧配置（`OPENAI_BASE_URL` + `OPENAI_API_KEY` + `LLM_MODEL`）保持零迁移兼容。

### Provider 预设

| id | base URL | 专属 Key 环境变量 |
|----|----------|-------------------|
| `openai` | `https://api.openai.com/v1` | `OPENAI_API_KEY` |
| `openrouter` | `https://openrouter.ai/api/v1` | `OPENROUTER_API_KEY` |
| `deepseek` | `https://api.deepseek.com/v1` | `DEEPSEEK_API_KEY` |
| `moonshot` | `https://api.moonshot.cn/v1` | `MOONSHOT_API_KEY` |
| `qwen` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `DASHSCOPE_API_KEY` |
| `zhipu` | `https://open.bigmodel.cn/api/paas/v4` | `ZHIPU_API_KEY` |
| `siliconflow` | `https://api.siliconflow.cn/v1` | `SILICONFLOW_API_KEY` |
| `groq` | `https://api.groq.com/openai/v1` | `GROQ_API_KEY` |
| `ollama` | `http://127.0.0.1:11434/v1` | 无（本地） |
| `lmstudio` | `http://127.0.0.1:1234/v1` | 无（本地） |
| `opencode` | `https://opencode.ai/zen/v1` | `OPENCODE_API_KEY` |
| `custom` | 由 `LLM_BASE_URL` 指定 | `LLM_API_KEY` / `LLM_PROVIDER_KEYS` |

### 角色路由

四个角色可分别指向不同 provider / model / key：

| 角色 | 用途 | 角色级变量前缀 |
|------|------|----------------|
| `main` | 主 Agent、普通问答 | `LLM_MAIN_*` |
| `deep` | `/deep` 深度分析 | `LLM_DEEP_*`（兼容 `DEEP_MODEL`） |
| `classify` | 查询分类 | `LLM_CLASSIFY_*` |
| `rewrite` | 查询重写 | `LLM_REWRITE_*` |

示例——主模型走 OpenRouter，深度分析走 DeepSeek：

```ini
LLM_PROVIDER=openrouter
LLM_MODEL=openai/gpt-4o-mini
OPENROUTER_API_KEY=sk-or-...

LLM_DEEP_PROVIDER=deepseek
LLM_DEEP_MODEL=deepseek-chat
DEEPSEEK_API_KEY=sk-ds...
```

解析优先级：`LLM_<ROLE>_*` → `LLM_PROVIDER` / `LLM_MODEL` / `LLM_API_KEY` / `LLM_BASE_URL` → 旧 `OPENAI_*` / `LLM_MODEL` → provider 预设默认值。

### 能力差异（JSON / thinking）

网关差异不再靠 `baseUrl.includes(...)` 猜：

- `jsonMode`：是否支持 `response_format=json_object`
- `jsonModeConflictsWithTools`：JSON 模式与工具调用互斥时，`deep` 角色自动退回提示词约束（OpenRouter / DeepSeek）
- `disableThinkingForJson`：JSON 模式必须显式关闭 thinking（OpenCode Zen）
- `LLM_DEEP_JSON_MODE=auto|on|off` 可人工覆盖

### 新增网关

- **OpenAI 兼容网关**：设置 `LLM_PROVIDER=custom` + `LLM_BASE_URL` + `LLM_MODEL` + `LLM_API_KEY`，无需改代码。
- **需要持久化多个网关**：用 `LLM_PROVIDERS_FILE` 外挂 JSON（见 `docs/llm-providers.md`）。
- **非 OpenAI 原生协议**（Anthropic / Gemini SDK）：实现 `ChatModelAdapter` 并用 `registerChatModelAdapter(protocol, adapter)` 注册，业务层不变。

## API 文档

启动服务后访问 `http://localhost:3001/docs` 查看 Swagger UI 文档（文档路径无需认证）。

所有 `/api/*` 端点支持 API 密钥认证（`X-API-Key` 请求头或 `Authorization: Bearer`）。

- 默认 `API_HOST=127.0.0.1`，单机自用可不配 `API_KEYS`（仅回环地址放行）。
- 监听 `0.0.0.0` / 局域网地址时必须配置 `API_KEYS`，否则启动失败。
- `API_KEYS` 不会回退 `OPENAI_API_KEY`：服务访问密钥与 LLM 供应商密钥必须分离。
- `GET /health` 为存活检查；`GET /ready` 会真实探测 ChromaDB 与 LLM 配置，未就绪返回 503。
- `GET /metrics` 暴露 Prometheus 指标（HTTP 延迟、查询数、降级数、检索文档数）。
- `POST /api/query` 返回结构化 `citations[]`（`refId/source/h2/snippet/score`）与 `conversationId/messageId`。

### 会话 API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/conversations` | 新建会话 |
| GET | `/api/conversations?limit=` | 会话列表 |
| GET | `/api/conversations/:id` | 会话详情 |
| GET | `/api/conversations/:id/messages?limit=&before=` | 消息分页 |
| PATCH | `/api/conversations/:id` | 重命名 |
| DELETE | `/api/conversations/:id` | 软删除 |

`POST /api/query` 可带 `conversationId`;不带则自动建会话。服务端会保存 user/assistant 消息、引用、耗时与降级标记。

### SSE v2 事件

```
event: meta      { conversationId }
event: token     { text }
event: citation  Citation
event: done      { response, queryType, docCount, citations, elapsed, conversationId, messageId }
event: error     { code, message }
```

## Web 前端

```bash
npm run dev:web     # 开发:Vite :5173,代理 /api 到 :3001
npm run build:web   # 生产:web/dist 由 Fastify 托管到 /
```

单页应用:问答（流式 + 引用侧栏）、深度分析、历史会话、系统状态、API Key 设置。移动端自适应。

## 命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动交互式 CLI |
| `npm run dev:tui` | TUI 模式 |
| `npm run dev:web` | Vite Web 开发服务器（代理 /api） |
| `npm run build:web` | 构建 Web 产物到 `web/dist` |
| `npm run server` | 启动 Fastify（API + Web 静态资源） |
| `npm run ingest` | 构建向量索引 + FTS5 + 索引清单 |
| `npm run migrate` | JSON → ChromaDB 数据迁移 |
| `npm run eval` | 检索质量评测（recall@5 / MRR / 无答案准确率） |
| `npm run pdf:inventory` | 扫描 pdf/ 生成 `corpus/manifest.yaml` |
| `npm run pdf:build` | PDF → Markdown（全量；可加 `-- --scope core`） |
| `npm run pdf:ocr` | 对无文字层 PDF 执行 OCR（macOS PDFKit + RapidOCR） |
| `npm run ocr:setup` | 安装 Python OCR 依赖（rapidocr_onnxruntime） |
| `npm run ocr:build` | 编译 Swift 渲染器 |
| `/deep <问题>` | 深度分析（结构化 JSON 输出） |
| `/history` | 查看对话历史 |
| `/status` | 知识库状态 |
| `/clear` | 清除对话历史 |
| `/exit` | 退出 |

## 数据存储

对话历史使用 SQLite 持久化（`SQLITE_PATH` 配置），支持多进程并发访问。
向量索引使用 ChromaDB。

## 项目结构

```
src/
  index.ts               CLI 入口（交互式/单次查询/TUI 路由）
  config.ts              唯一配置入口（所有环境变量集中管理）
  config-validation.ts   启动时配置验证
  types.ts               共享类型定义
  errors.ts              错误分类体系（ErrorCode 枚举 + YijingError 层级）
  logger.ts              pino 结构化日志（含敏感数据脱敏）
  llm/                   第三方大模型接入（provider 预设 + 角色路由 + adapter）
  metrics.ts             Prometheus 指标
  ingestion/             知识库导入（摘要 + 全文语料、分块、领域推断）
  vectorstore/           ChromaDB + FTS5（语义检索、混合检索、索引清单、迁移）
  rag/                   RAG 链（查询分类、重写、引用追踪/校验）
  agents/                DeepAgent.js 编排（agenticRag / deepAnalysis + 工具）
  conversation/          会话与消息持久化（SQLite schema v2）
  api/                   Fastify REST API（路由、SSE v2、安全中间件、Web 静态托管）
    middleware/          认证、速率限制、安全头中间件
  __tests__/             Vitest 单元测试

web/                     React 19 + Vite + Tailwind 前端
tools/pdf2md/            PDF → Markdown 管线（提取/清洗/切分/QA）
eval/                    检索评测（golden.jsonl + run.ts）
corpus/                  语料台账与生成结果（生成目录不入库）
tui/                     Vue-termui 终端界面（根目录独立子工程）
```

## 架构

```
memory/*.md (curated) ─┐
corpus/*.md  (fulltext) ─┴→ ingest → ChromaDB + FTS5 → agenticRag → 查询分类/混合检索 → DeepAgent → 响应 / SSE
```

索引采用版本化集合:`yijing_knowledge_v<timestamp>`;ingest 先写新集合,校验通过后写 `data/index-manifest.json` 切换 active collection,失败保留旧索引。`/ready` 会校验清单与当前 embedding/分块参数是否一致。

跨层调用规范：
- `agents/` 通过 `rag/`、`vectorstore/`、`conversation/` 取数据，反向导入禁止。
- 对外函数签名（`agenticRag`、`deepAnalysis`）是稳定契约，修改需同时验证 CLI / TUI / API / Web。
- 新增工具/子代理必须挂进 `deep-agent.ts` 注册表，并同步 `agents.test.ts`。

## 开发门禁

**每次改动后必须运行**：
```bash
npm run typecheck && npm test   # test 内含覆盖率门禁 (statements/lines ≥ 60%)
```

**提交前**：
```bash
npm run lint && npm run format && npm run typecheck:web
```

**CI 流水线**（`.github/workflows/ci.yml`）：`lint → typecheck → test → build → typecheck:web → build:web → typecheck:tui → build:tui`

## Docker 部署

```bash
# 必须设置服务访问密钥(容器监听 0.0.0.0)
echo "API_KEYS=$(openssl rand -hex 24)" >> .env
docker-compose up -d
```

Chroma 固定为 `chromadb/chroma:1.0`,健康检查使用 `/api/v2/heartbeat`;API 容器内置 Web 静态产物。

API 服务默认端口 `3001`，ChromaDB 默认端口 `8000`。

## 领域合规

- 输出中医/命理建议必须带免责声明（"仅供学习研究,不能替代面诊/医嘱"）
- 不给绝对性断言
- `memory/jiapu.md` 等涉及个人信息的文件：读取但不得外传到日志、不得写入 commit

## 免责声明

该知识库仅供中医理论学习和文化研究参考，不能替代合格医师面诊、诊断、处方、用药或针灸操作。

## 许可证

MIT
