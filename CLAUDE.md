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

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **yijing** (870 symbols, 1401 relationships, 53 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/yijing/context` | Codebase overview, check index freshness |
| `gitnexus://repo/yijing/clusters` | All functional areas |
| `gitnexus://repo/yijing/processes` | All execution flows |
| `gitnexus://repo/yijing/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
