# Yijing Agentic RAG — AI 编码规范

倪海厦中医命理知识库的 Agentic RAG 系统。技术栈:TypeScript(ESM, Node ≥ 22)+ LangChain 1.x + DeepAgent.js 多智能体 + Fastify 5(REST/SSE)+ ChromaDB + better-sqlite3 + pino + zod。提供 CLI(readline/ink TUI)与 API 双入口。

## 1. 常用命令

| 命令 | 说明 | 何时运行 |
|------|------|----------|
| `npm run dev` | tsx 启动交互式 CLI | 日常调试 |
| `npm run dev:tui` | ink TUI 模式(`TUI=true`) | TUI 调试 |
| `npm run server` | Fastify API 服务(`START_MODE=server`, 默认 :3001) | API 调试 |
| `npm run ingest` | 重建 ChromaDB 向量索引 | 知识库变更后 |
| `npm run migrate` | JSON → ChromaDB 数据迁移 | 迁移场景 |
| `npm run typecheck` | `tsc --noEmit` 类型检查 | **每次改动必跑** |
| `npm test` | Vitest 单测 | **每次改动必跑** |
| `npm run lint` / `lint:fix` | Biome 检查 / 自动修复 | 提交前必跑 |
| `npm run format` | Biome 格式化 | 提交前 |
| `npm run build` | tsc 编译到 `dist/` | 发布 / CI 门禁 |

**改动完成的最小门禁:** `npm run typecheck && npm test`; 提交前再加 `npm run lint`。

## 2. 架构与模块边界

```
src/
  index.ts          CLI 入口(单次查询 / readline / TUI 路由分发)
  config.ts         唯一配置入口:所有 .env 变量集中于此,禁止散落 process.env
  types.ts          共享类型(KnowledgeMetadata / QueryResult / StreamChunk …)
  errors.ts         错误分类体系:ErrorCode 枚举(1xxx~6xxx)+ YijingError 子类
  logger.ts         pino 结构化日志: rootLogger + createLogger(module) + 请求上下文
  ingestion/        Markdown 加载与分块 → 入库
  vectorstore/      ChromaDB 直连 / embedding / 迁移
  rag/              RAG 链:查询分类、重写、重排序、上下文裁剪、引用
  agents/           DeepAgent.js 编排(agenticRag / deepAnalysis)+ tools + prompts
  conversation/     对话历史持久化(SQLite)
  api/              Fastify server + /api 路由(query/history/deep/status) + SSE
  tui/              ink 终端界面
  __tests__/        Vitest 测试(禁止散落在 src 其他位置)
```

**核心数据流**: `memory/*.md → ingest → ChromaDB → agenticRag(请求) → 查询分类/检索 → DeepAgent 组装 → 响应 / SSE 流式`

跨层调用规范:
- `agents/` 通过 `rag/`、`vectorstore/`、`conversation/` 取数据,反向(下层 import 上层)禁止。
- 对外函数签名与响应结构(如 `agenticRag`、`deepAnalysis`)是稳定契约,修改需同时验证 CLI 与 API 两条消费路径。
- 新增工具/子代理必须挂进 `deep-agent.ts` 的注册表,并同步 `agents.test.ts`。

## 3. 代码规范

- **ESM**:相对导入必须带 `.js` 后缀(如 `import { config } from "../config.js"`),禁止路径别名。
- **类型安全**(`tsconfig` strict):禁止 `any`、`@ts-ignore`、`@ts-expect-error`、无意义的非空断言;LLM 结构化输出必须用 zod schema 校验(参考 `DEEP_ANALYST_RESPONSE_SCHEMA`),解析失败要有回退语义,不能直接崩溃。
- **错误处理**:统一抛 `YijingError` 派生类 + `ErrorCode` 枚举;`catch` 里禁止空吞,必须 ①重新包装抛出 或 ②记录日志;API 层用 `toJSON()` 输出 `{error: {code, message}}`,严禁把内部堆栈 / 密钥透出给调用方。重试/超时/限流错误走 `LLMError` 的既有 code。
- **日志**:业务路径一律 `createLogger("模块名")` ,禁止 `console.log` 混入业务代码(CLI 用户输出除外);API key、认证头等敏感字段依赖 logger 内置 redact,新增敏感字段要同步加进 redact 列表。
- **配置**:新环境变量必须「进 `config.ts` 带默认值 + 同步 `.env.example` 注释」双写;检索/分块参数都要走配置,不允许硬编码 magic number。
- **格式化**:Biome —— 双引号、分号、2 空格缩进、120 列、trailing commas。改完代码跑 `npm run lint`。
- **中文注释约定**:文件头块注释解释模块职责与不变式;`/deep` 深度分析等关键路径的复杂逻辑必须有注释说明意图,不许只写"what"不写"why"。

## 4. 测试规范

- 测试统一放 `src/__tests__/`,命名 `*.test.ts`,用 Vitest。
- **禁止真实外部依赖**:LLM / ChromaDB / 网络请求必须 mock(`vi.mock("../config.js")` 注入测试 config),保证测试可离线、可重复。
- 文件副作用用临时目录:`vi.hoisted` 创建 `/tmp/yijing-*-` 并在 `afterAll` 清理(参考 `store.test.ts` 模式)。
- 对解析 / 转换类函数(loaders、JSON 提取、聊天历史解析、citation 计数)必须有边界用例:空输入、畸形输入、超长输入。
- 失败用例必须修复而非删除 / 跳过 / 改标记绕过。

## 5. 工作流与门禁

- **CI 流水线顺序**(`.github/workflows/ci.yml`):`lint → typecheck → test → build`,Node 22。本地提交前自测这一条链。
- **改动任何符号前**:按下方 GitNexus 规则跑 `impact({target, direction:"upstream"})`,向用户汇报 blast radius;HIGH / CRITICAL 必须先停住征求用户决定。
- **提交前**:`gitnexus detect_changes()` 核验改动范围;commit message 沿用仓库习惯(小写类型前缀+中文描述,参考 `git log` 的 `fix:` `refactor:` `chore:` `docs:` 风格),不搞大锅炖一次提交。
- **禁止提交**:`.env`(密钥)、`logs/`、`chroma_data/`、`data/`、`dist/`;(gitignore 已覆盖,不要顺手 `git add -f` 绕过)。

## 6. 领域合规

- 输出中医 / 命理建议必须带免责声明("仅供学习研究,不能替代面诊/医嘱"),不给绝对性断言;回答超出知识库覆盖的,明确告知"知识库无此内容",不编造文献出处。
- `memory/jiapu.md` 等涉及个人信息的文件:读取但不得外传到日志、不得写入 commit。

## 7. 速查表

| 想做什么 | 看哪里 |
|----------|--------|
| 改 CLI 命令 / 启动流程 | `src/index.ts` |
| 改 API 路由 | `src/api/server.ts` + `src/api/routes/` |
| 改检索分类 / RAG 链 | `src/rag/` |
| 改 Agent 编排 / 工具 | `src/agents/` |
| 改向量存储 | `src/vectorstore/` |
| 改知识库导入 | `src/ingestion/` |
| 改对话历史 | `src/conversation/` |
| 加环境变量 | `src/config.ts` + `.env.example` |

---

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
