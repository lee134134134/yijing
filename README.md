# 倪海厦知识库 - Agentic RAG

基于倪海厦人纪/天纪系列知识库的 Agentic RAG（检索增强生成）系统，使用 DeepAgent.js 多智能体框架（LangChain 1.x）实现。提供 CLI、TUI、REST API 三种交互方式。

> **Node 版本要求**：Node ≥ 26.3（`.nvmrc`、`package.json` engines、Dockerfile 统一）

## 快速开始

```bash
# 安装依赖
npm install

# 构建知识库索引
npm run ingest

# 启动交互式 CLI（readline）
npm run dev

# 启动全屏终端 TUI（vue-termui 实现）
npm run build:tui
npm run tui

# 启动 REST API 服务
npm run server

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
| `EMBEDDING_PROVIDER` | `local` | Embedding 提供方：`local`（本地模型，离线可用）/ `api`（OpenAI 兼容 API） |
| `EMBEDDING_MODEL` | `Xenova/all-MiniLM-L6-v2` | Embedding 模型（`api` 时默认 `text-embedding-3-small`） |
| `EMBEDDING_DIMENSION` | `384` | 向量维度（`api` 时默认 `1536`） |
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
| `KNOWLEDGE_DIR` | `./memory` | 知识库 Markdown 目录 |

> 切换 `EMBEDDING_PROVIDER`（local ↔ api）或更换 `EMBEDDING_MODEL` 会改变向量语义/维度，必须重新执行 `npm run ingest`。
> 中文知识库建议：`Xenova/bge-small-zh-v1.5`（512 维，中文语义区分度显著优于默认英文模型）。

## API 文档

启动服务后访问 `http://localhost:3001/docs` 查看 Swagger UI 文档。

所有 API 端点均支持 API 密钥认证（`X-API-Key` 请求头）。

## 命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动交互式 CLI |
| `npm run dev:tui` | TUI 模式 |
| `npm run server` | 启动 Fastify REST API 服务 |
| `npm run ingest` | 构建 ChromaDB 向量索引 |
| `npm run migrate` | JSON → ChromaDB 数据迁移 |
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
  utils/
    retry.ts             重试工具（指数退避 + 超时控制）
  ingestion/             知识库导入（Markdown 加载、分块、领域推断）
  vectorstore/           ChromaDB 向量存储（语义检索、多查询融合、迁移）
  rag/                   RAG 链（查询分类、重写、上下文管理、引用追踪）
  agents/                DeepAgent.js 编排（agenticRag / deepAnalysis + 工具）
  conversation/          对话历史持久化（SQLite）
  api/                   Fastify REST API（路由、SSE 流式、安全中间件）
    middleware/          认证、速率限制、安全头中间件
  tui/                   Vue-termui 终端界面
  __tests__/             Vitest 单元测试
```

## 架构

```
memory/*.md → ingest → ChromaDB → agenticRag(请求) → 查询分类/检索 → DeepAgent 组装 → 响应 / SSE 流式
```

跨层调用规范：
- `agents/` 通过 `rag/`、`vectorstore/`、`conversation/` 取数据，反向导入禁止。
- 对外函数签名（`agenticRag`、`deepAnalysis`）是稳定契约，修改需同时验证 CLI 与 API 两条消费路径。
- 新增工具/子代理必须挂进 `deep-agent.ts` 注册表，并同步 `agents.test.ts`。

## 开发门禁

**每次改动后必须运行**：
```bash
npm run typecheck && npm test
```

**提交前**：
```bash
npm run lint && npm run format
```

**CI 流水线**（`.github/workflows/ci.yml`）：`lint → typecheck → test → build`

## Docker 部署

```bash
docker-compose up -d
```

API 服务默认端口 `3001`，ChromaDB 默认端口 `8000`。

## 领域合规

- 输出中医/命理建议必须带免责声明（"仅供学习研究,不能替代面诊/医嘱"）
- 不给绝对性断言
- `memory/jiapu.md` 等涉及个人信息的文件：读取但不得外传到日志、不得写入 commit

## 免责声明

该知识库仅供中医理论学习和文化研究参考，不能替代合格医师面诊、诊断、处方、用药或针灸操作。

## 许可证

MIT
