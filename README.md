# 倪海厦知识库 - Agentic RAG

基于倪海厦人纪/天纪系列知识库的 Agentic RAG（检索增强生成）命令行工具。默认使用 **DeepAgent.js 多智能体框架**（LangChain 1.x 之上），并保留旧确定性 RAG 管线作为 `AGENT_MODE=classic` 回退。

## 快速开始

```bash
# 安装依赖
npm install

# 构建知识库索引
npm run ingest

# 启动交互式 CLI
npm run dev

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
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding 模型名称 |
| `EMBEDDING_DIMENSION` | `1536` | Embedding 向量维度 |
| `CHROMA_DB_URL` | `http://127.0.0.1:8000` | ChromaDB 服务地址 |
| `CHROMA_COLLECTION_NAME` | `yijing_knowledge` | ChromaDB 集合名称 |
| `ENABLE_RERANKING` | `false` | 启用 LLM 重排序 |
| `MAX_HISTORY` | `200` | 对话历史最大保留条数 |
| `KNOWLEDGE_DIR` | `./memory` | 知识库 Markdown 目录 |
| `AGENT_MODE` | `deep` | 代理模式：`deep`（DeepAgent.js 多智能体）或 `classic`（旧确定性 RAG 管线） |

## 代理模式

`AGENT_MODE` 控制问答编排方式：

| 模式 | 说明 |
|------|------|
| `deep`（默认） | DeepAgent.js 多智能体：`createDeepAgent` 深度代理自主检索（`search_knowledge_base` / `search_by_domain` 工具）+ 流式输出；`/deep` 由 `deep_analyst` 子代理输出结构化 5 字段 JSON |
| `classic` | 旧确定性 RAG 管线：查询重写 → 多路检索 → 重排序 → 生成，作为回退方案保留 |

## 命令

| 命令 | 说明 |
|------|------|
| `/deep <问题>` | 深度分析（结构化 JSON 输出） |
| `/history` | 查看对话历史 |
| `/status` | 知识库状态 |
| `/clear` | 清除对话历史 |
| `/help` | 帮助 |
| `/exit` | 退出 |

## 项目结构

```
src/
  index.ts               CLI 入口
  config.ts              配置管理
  types.ts               类型定义
  ingestion/
    loader.ts            Markdown 加载和分块
    index.ts             索引构建入口
  vectorstore/
    chroma.ts            ChromaDB 向量检索
    embeddings.ts        Embedding 管理器
    migration.ts         JSON → ChromaDB 迁移
    index.ts             统一导出
  rag/
    chain.ts             RAG 检索链 + 查询分类
  agents/
    index.ts             Agent 编排入口（双模式分发）
    deep-agent.ts        DeepAgent.js 深度代理（agenticRag / deepAnalysis）
    legacy.ts            旧确定性 RAG 管线（AGENT_MODE=classic 回退）
    tools.ts             Agent 工具函数（search_knowledge_base / search_by_domain）
    prompts.ts           DeepAgent 系统提示词
  conversation/
    store.ts             对话持久化存储
memory/                  知识库 Markdown 文件
data/                    旧版 JSON 索引（迁移后自动备份为 .bak）
```

## 环境要求

- **Node.js >= 22**
- **ChromaDB** — 向量数据库服务。启动方式：
  ```bash
  docker run -p 8000:8000 chromadb/chroma
  ```

## 免责声明

该知识库仅供中医理论学习和文化研究参考，不能替代合格医师面诊、诊断、处方、用药或针灸操作。

## 许可证

MIT
