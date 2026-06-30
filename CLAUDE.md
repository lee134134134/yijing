# 项目指南

这是一个基于倪海厦知识体系的中医命理项目（易经/天纪/人纪）。

## 知识库

项目包含倪海厦人纪/天纪系列的知识库 Markdown 文件，存储在 `memory/` 目录。

## Agentic RAG 系统

项目已集成基于 LangChain.js 的 Agentic RAG 系统。

### 使用方式

```bash
# 1. 首次使用：构建知识库索引
npm run ingest

# 2. 启动交互式 CLI 咨询
npm run dev

# 3. 或单次查询
npx tsx src/index.ts "桂枝汤的组成和适应症是什么？"
```

### 系统架构

```
src/
  index.ts               CLI 入口
  config.ts              配置管理（支持 .env）
  types.ts               类型定义
  ingestion/
    loader.ts            Markdown 加载和分块
    index.ts             索引构建入口
  vectorstore/
    chroma.ts            本地向量存储（n-gram 中文检索）
  rag/
    chain.ts             RAG 检索链 + 查询路由
  agents/
    index.ts             Agentic RAG 编排
    tools.ts             Agent 工具
```

### 配置

编辑 `.env` 文件配置：
- `OPENAI_BASE_URL` — OpenAI 兼容 API 地址
- `LLM_MODEL` — 模型名称（默认 deepseek-v4-flash）
- `KNOWLEDGE_DIR` — 知识库目录

### 环境要求

- Node.js >= 22
- npm / bun

## 长时记忆（供 AI 使用）

每次会话开始时读取：
- `memory/jiapu.md` — 家庭成员生辰八字
- `memory/README.md` — 知识库总纲
- 各领域知识纲要文件
