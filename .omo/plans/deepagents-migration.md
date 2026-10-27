# 迁移计划:yijing-agentic-rag → DeepAgent.js

> 状态: **待用户审查**(审查通过前不进行任何代码修改)
> 创建: 2026-08-01
> 审查人: 用户(lee)

---

## 1. 背景与目标

项目 `yijing-agentic-rag` 是倪海厦知识库 Agentic RAG 系统(LangChain 0.3.x,~3300 行 TS)。
当前架构为**确定性 RAG 管线**:分类 → 重写 → 检索 → 裁剪 → 6 选 1 Prompt → 生成。
此架构对单轮问答效果好,但**无法处理多步/跨领域/需要自我修正的复杂任务**。

目标:迁移到 LangChain 官方 **DeepAgent.js**(`deepagents` 包),获得:
1. 自主规划与多轮工具调用(检索不足时自动换角度重试)
2. Subagent 上下文隔离(复杂任务拆解)
3. 内置上下文管理(压缩/卸载,替代手写 token 裁剪)
4. 稳定的结构化输出(替代手写 JSON 正则修复循环)

**硬性约束(不可破坏)**:
- API 响应结构保持兼容(`/query` 非流式 + SSE 流式、`/deep` 结构化 JSON)
- 引用脚注 `[ref-N]` 机制保留(前端依赖)
- CLI 交互命令不变(`/deep` `/history` `/status` `/clear` `/help`)
- 知识库数据(ChromaDB collection)与 `data/` 目录不迁移、不重建
- 中文中医命理 persona 与免责声明语义完整保留

---

## 2. 现状架构分析

```
┌─ CLI (src/index.ts, readline) ──────────────┐
│  └─ agenticRag(input, chatHistory?, onToken?) │
│  └─ deepAnalysis(input)                        │
└──────────────────────────┬───────────────────┘
                           │
┌─ API (Fastify) ──────────┼───────────────────┐
│  /api/query (SSE)  /api/deep  /api/history    │
│  /api/status  /health                         │
└──────────────────────────┬───────────────────┘
                           ▼
┌─ src/agents/index.ts (确定性管线) ───────────┐
│  queryRouter (classifyQuery)                 │
│  retrievalStage (rewriteQuery→multiQuerySearch│
│  rerankDocs (可选)                           │
│  prepareContext/buildCitedContext (token裁剪) │
│  getPromptForType (6选1) → LLM → 引用脚注      │
│  deepAnalysis (JSON正则修复循环)              │
└──────────────────────────┬───────────────────┘
                           ▼
┌─ 基础设施(与框架无关,可复用) ────────────────┐
│  vectorstore/chroma.ts (Chroma from community)│
│  vectorstore/embeddings.ts (@xenova 本地模型) │
│  rag/citation.ts  rag/context-manager.ts      │
│  rag/query-rewriting.ts  rag/chain.ts         │
│  conversation/store.ts (JSON文件)  errors.ts  │
│  logger.ts  config.ts  types.ts  ingestion/   │
└──────────────────────────────────────────────┘
```

### 当前依赖版本(2026-08-01 实测)

| 包 | 版本 |
|---|---|
| langchain | 0.3.37 |
| @langchain/core | 0.3.80 |
| @langchain/openai | 0.4.9 |
| @langchain/community | 0.3.59 (提供 Chroma vectorstore) |
| @xenova/transformers | 2.17.2 (本地 embedding,离线) |
| @huggingface/transformers | 4.2.0 (已装未用) |
| chromadb | 3.5.0 (JS 客户端,已装) |
| fastify / ink / better-sqlite3 | — |

### DeepAgent.js 关键事实(已核对官方文档 2026-08)

- `createDeepAgent({ model, systemPrompt, tools, memory, skills, backend, permissions, subagents, middleware, interruptOn, responseFormat })`,返回编译后的 LangGraph agent
- `model` 支持字符串 `"openai:gpt-5.5"` 或**初始化实例**(`new ChatOpenAI({...})`,兼容本项目 baseURL/apiKey 自定义)
- 工具用 LangChain 1.x `tool()` + zod schema(旧 `DynamicTool` 已废弃)
- 内置文件系统中间件(默认开启,隐藏模型可见工具需 harness profile `excluded_tools`)
- 规划能力:`todoListMiddleware()`(opt-in,v0.7+)
- 流式:`agent.streamEvents(input, {version:"v3"})` → `stream.messages` / `stream.toolCalls` / `stream.subagents`
- 依赖 peer:`langchain`(1.x)、`@langchain/langgraph`、`@langchain/langgraph-checkpoint`、`@langchain/langgraph-sdk`、`langsmith`
- 自定义 subagent:声明式 `subagents: [{ type, model, systemPrompt, tools, ... }]`

---

## 3. 目标架构

```
┌─ CLI / API (接口不变) ───────────────────────┐
│  agenticRag() → buildDeepAgent().invoke/stream │
│  deepAnalysis() → subagent / responseFormat    │
└──────────────────────────┬───────────────────┘
                           ▼
┌─ src/agents/deep-agent.ts (新增,核心) ───────┐
│  createDeepAgent({                          │
│    model: new ChatOpenAI({...config}),      │
│    systemPrompt: 中文中医命理专家 persona     │
│      (融合原6个领域prompt要点+引用格式+免责)   │
│    tools: [searchKnowledge, searchByDomain],│
│    middleware: [todoListMiddleware()],      │
│    subagents: [deepAnalyst] (可选)          │
│  })                                          │
└──────────────┬───────────┬──────────────────┘
               ▼           ▼
┌─ tools.ts (重写)        ┌─ 基础设施(零改动) ─┐
│  tool() + zod           │  chroma.ts 检索    │
│  searchKnowledgeBase    │  citation.ts       │
│  searchByDomain         │  context-manager   │
└──────────────┬──────────┴───────────────────┘
               ▼
   vectorstore (Chroma / 本地 embedding,保持现状或换@langchain/chroma)
```

**架构范式变化**:确定性管线 → 工具调用循环。
LLM 自主决定:搜什么领域、搜几次、何时综合、是否委托 subagent。

---

## 4. 关键决策点(需要审查人拍板)

| # | 决策 | 选项 | 推荐 |
|---|---|---|---|
| D1 | 内置文件系统工具(ls/read_file/write_file/edit_file 等) | A. 用 harness profile `excluded_tools` 全部隐藏 B. 保留 | **A 隐藏**——知识库 QA 场景不应让 agent 读写服务器文件;降低幻觉写入风险 |
| D2 | 旧的确定性管线 | A. 删除 B. 保留为 legacy + 配置开关 `AGENT_MODE=classic\|deep` | **B 保留一期**(开关默认 deep),A/B 对比后再删 |
| D3 | todo 规划中间件 | A. 启用 B. 不启用 | **A 启用**——成本低,复杂任务表现提升明显,且 TUI 可展示进度 |
| D4 | `/deep` 实现方式 | A. 主 agent `responseFormat` 结构化输出 B. 自定义 subagent `deep_analyst` | **B subagent**(上下文隔离,主 agent 只收结果);A 作为备选验证 |
| D5 | Chroma vectorstore 升级 | A. `@langchain/community` 0.3 继续用(临时保留) B. 迁移到 `@langchain/chroma`(1.x 官方包) C. 直接用 `chromadb` JS 客户端手写检索(已装 3.5.0) | **C 首选**(零新依赖、接口完全自控、绕开 community 兼容性问题);失败再退 B |
| D6 | 版本锁定 | 锁定 deepagents + langchain 1.x 精确版本 | **锁定**(deepagents 迭代快,防 breaking change) |
| D7 | queryType 返回值 | A. 保留入口 classifyQuery(多 1 次 LLM 调用) B. 从 agent toolCalls 推断 C. 返回 unknown | **A 保留**(API 响应结构兼容优先,成本可接受) |
| D8 | 对话历史 | A. 继续用 conversation/store.ts 构造 messages B. 迁移到 LangGraph checkpoint 持久化 | **A**(最小改动,checkpoint 留作二期) |

---

## 5. 分阶段实施(文件级改动清单)

### Phase 0 — 基线(0.5h)
- [ ] 确认 git 干净: `git status`
- [ ] 运行 `npm run typecheck && npm run lint && npm run test`,记录基线结果
- [ ] 手动记录 5 个代表性问题的现有回答(用于迁移后 A/B 对比):
  1. 单轮方剂:「桂枝汤的组成和适应症是什么?」
  2. 跨领域综合:「失眠多梦,手心发热,该从哪些角度调理?」
  3. 需多轮检索:「伤寒论中关于汗法的论述,对比桂枝汤证和麻黄汤证」
  4. `/deep` 结构化:「分析脾肾阳虚的辨证要点」
  5. 冷门问题(预期检索失败):「倪海厦关于汽车风水怎么看」

### Phase 1 — 依赖升级(0.5~1d)
- [ ] `package.json` 变更:
  - 升级:`langchain` 0.3.37 → 1.x、`@langchain/core` → 1.x、`@langchain/openai` → 1.x
  - 新增:`deepagents`(锁定版本)、`@langchain/langgraph`、`@langchain/langgraph-checkpoint`、`@langchain/langgraph-sdk`、`langsmith`
  - 临时保留:`@langchain/community` 0.3.59(Phase 2 完成后移除)
  - `@xenova/transformers` 不动(embeddings.ts 的 `Embeddings` 基类 1.x 兼容,需验证)
- [ ] `npm install`,解决 peer 依赖冲突
- [ ] 冒烟:`npm run typecheck` 通过前,**不写任何业务逻辑**——先修好所有因升级产生的类型错误:
  - 迁移清单:所有 `from "langchain/*"`、`from "@langchain/core/*"` 导入路径
  - `@langchain/core/documents` 的 `DocumentInterface`(types.ts)
  - `PromptTemplate`/`StringOutputParser` 用法(1.x 基本兼容,验证即可)
  - `DynamicTool` 移除(Phase 3 重写)

### Phase 2 — 基础设施适配(0.5d,行为不变)
- [ ] `src/vectorstore/chroma.ts`:按 **D5-C** 重构为直接调用 `chromadb` 3.5.0 客户端:
  - `getStore()`: `ChromaClient` 单例 + `collection.get()` 查询
  - 保留导出签名:`searchKnowledge(query, k)`、`searchByDomain(query, domain, k)`、`multiQuerySearch(queries, k)`、`getDocumentCount()`、`listCollections()`、`getCollectionInfo()`
  - RRF 融合逻辑原样保留
  - 移除 `@langchain/community/vectorstores/chroma` 依赖 → 删除 `@langchain/community`
- [ ] `src/vectorstore/embeddings.ts`:验证 `Embeddings` 基类导入路径;如变则改为 `@langchain/core` 新路径,类实现不动(本地模型,离线)
- [ ] 回归: `npm run test`(store.test.ts / loader.test.ts 应全绿)+ 手动 `npm run ingest` 验证

### Phase 3 — 工具层重写(0.5d)
- [ ] 重写 `src/agents/tools.ts`(删除 `DynamicTool`,改 `tool()` + zod):
  - `search_knowledge_base({ query, topK? })` → 返回文档文本,**每个文档首行带 `【来源】file > h2 | domain` 格式**(引用锚点)
  - `search_by_domain({ domain, query, topK? })` → 同上,domain 枚举沿用现有 15 类
  - 删除 `classify_query` 工具(分类由系统提示词承担,不再作为工具暴露)
  - 工具输出经 `context-manager.ts` 的 `estimateTokens` 截断(每文档 ≤800 字,与现状一致)
- [ ] 可选:新增 `lookup_tcm_terms({ term })` 工具(二期,先不做)

### Phase 4 — Agent 层(1d,核心)
- [ ] 新建 `src/agents/deep-agent.ts`:
  - `buildDeepAgent()`:单例构建,入参 `{ queryTypeHint? }`
  - `createDeepAgent({
       model: new ChatOpenAI({ model: config.llmModel, temperature: config.llmTemperature, configuration: { baseURL, apiKey } }),
       systemPrompt: DEEP_SYSTEM_PROMPT,
       tools: [searchKnowledgeBaseTool, searchByDomainTool],
       middleware: [todoListMiddleware()],   // D3
       subagents: [deepAnalyst],             // D4
     })`
  - **D1 实现**:查 reference 确认 JS harness profile API,注册 profile 隐藏文件系统工具(`ls/read_file/write_file/edit_file/delete/glob/grep`);若 JS 侧 API 未就绪,备选:配置 `backend` 为受限内存后端 + system prompt 强约束"不得使用任何文件操作工具"
- [ ] 新建 `src/agents/prompts.ts`(从 index.ts 抽取):
  - `DEEP_SYSTEM_PROMPT`:中文 persona,融合现有 6 个领域 prompt 的核心要求(辨证/方剂/命理/面相/养生/通用)+ 引用格式约定(`[ref-N]`)+ 免责声明 + 工具使用策略(多轮检索、跨领域时分别检索各领域)
  - `DEEP_ANALYST_PROMPT`:`/deep` 用,输出 5 字段 JSON(conclusion/reasoning/references/confidence/suggestions)
- [ ] 重写 `src/agents/index.ts`:
  - `agenticRag(input, chatHistory?, onToken?)` 保持签名与返回 `{ response, queryType, docCount }`:
    - `queryType`:调 `classifyQuery`(D7-A)
    - 构造 `messages`:system 提示由 agent 自带;`chatHistory` 解析为历史消息数组 + 当前 user 消息(用现有 `conversation/store.ts` 的 `getRecentHistory()`)
    - 非流式:`agent.invoke({ messages })` → 取最终 assistant 文本
    - 流式:`agent.streamEvents(input, { version: "v3" })` 迭代 `stream.messages`,逐段回调 `onToken`;并行迭代 `stream.toolCalls` 收集检索调用次数(用于 docCount 近似值)
    - 引用处理:复用 `citation.ts` 的 `parseCitations`/`formatCitations`(原逻辑不动)
    - **检索空结果回退**:若最终回答无引用且工具调用为 0,返回与现状一致的"未检索到相关内容"提示语
  - `deepAnalysis(input)` → 委托 `deep_analyst` subagent,返回 `AnalysisResult`;subagent 内部用 `withStructuredOutput` 或 JSON schema 约束,保留现有兜底(fallback 返回文本)
  - 保留 `withRetry`/`rerankDocs` 等工具函数(如不再使用则标记废弃,不删除——Phase 5 后清理)
  - 旧管线函数迁至 `src/agents/legacy.ts`(D2-B),仅 `AGENT_MODE=classic` 时使用
- [ ] `src/config.ts` 新增:`agentMode: "deep" | "classic"`(默认 deep)、`deepAgentMaxIterations`(默认 25,控成本)、`enableTodoPlanning`(默认 true)

### Phase 5 — API 层(0.5d,响应结构不变)
- [ ] `src/api/routes/query.ts`:
  - 流式分支:SSE 事件增加 `meta` 块(携带 queryType/docCount,结构沿用现有 `StreamChunk`);文本块继续走 `onToken` 通道
  - 非流式分支:返回结构 `{ response, queryType, docCount, elapsed }` 不变
- [ ] `src/api/routes/deep.ts`:调用新 `deepAnalysis`,响应字段不变
- [ ] `src/api/routes/status.ts`:增加 `agentMode` 字段(附加字段,不破坏兼容)
- [ ] `src/index.ts`(CLI):仅替换内部调用,命令与输出格式不变;TUI 流式路径同 API

### Phase 6 — 测试(0.5~1d)
- [ ] 重写 `src/__tests__/agents.test.ts`(现 mock 的是确定性管线内部模块,需改为 mock deepagent 边界):
  - 新测试策略:mock `deepagents` 的 `createDeepAgent`(返回可控假 agent),验证 `agenticRag` 的消息构造/引用脚注/空结果回退/流式回调
  - 工具层单测:`search_knowledge_base` 输出格式(来源行 + 截断)
  - `deepAnalysis` fallback 路径
- [ ] `store.test.ts` / `loader.test.ts`:预期零改动全绿
- [ ] `npm run typecheck && npm run lint && npm run test` 全绿

### Phase 7 — 验证与 A/B(0.5~1d)
- [ ] 手动跑 Phase 0 记录的 5 个问题,对比新旧回答质量(重点:多轮检索是否发生、引用是否准确、免责声明是否保留)
- [ ] 流式 SSE 用 `curl -N` 验证事件流完整(meta 块 + 文本块 + done)
- [ ] `/deep` 输出 5 字段 JSON 校验通过(zod)
- [ ] 资源检查:复杂问题 token 消耗 vs 旧管线(记录 maxIterations 是否触顶)
- [ ] 性能:单轮问答延迟对比(deepagent 冷启动 agent 构建时间是否可接受——agent 单例化解决)

### Phase 8 — 清理(0.5d)
- [ ] 删除 `src/agents/legacy.ts`(A/B 完成且确认后)或保留(用户决定)
- [ ] 删除 `@langchain/community`(Phase 2 已无引用)、无用 prompt 常量
- [ ] 更新 README(架构说明、`AGENT_MODE` 配置、新依赖)
- [ ] `npm run build && npm run start` 生产模式冒烟

---

## 6. 风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| deepagents JS API 迭代快,文档示例为 Python 为主 | 中 | 版本锁定;实现时以 reference.langchain.com/javascript 为准;D1/D4 均有备选方案 |
| `@langchain/core` 0.3 → 1.x breaking changes 波及未预见文件 | 中 | Phase 1 单独完成,typecheck 全绿再继续;改动面小(~10 个文件) |
| 中文场景 agent 输出引用格式漂移(漏 [ref-N]) | 中 | system prompt 强约束 + `parseCitations` 后处理 + A/B 验证;必要时工具输出自带来源编号强制模型引用 |
| agent 自主检索导致 token 成本上升 | 中 | `maxIterations` 上限 25 + 工具 topK 默认 5 + 观察 Phase 7 实测 |
| 文件系统工具被误用(即使隐藏,子代理也可能带出) | 低 | D1 隐藏 + 无 sandbox backend(无 execute 工具)+ 权限规则 deny 敏感路径 |
| Chroma 1.x 迁移踩坑 | 中 | D5-C 直接用 chromadb 客户端,接口自控,已安装无新依赖 |
| 流式 SSE 与 agent.streamEvents 事件模型差异 | 中 | 只消费 `stream.messages` 文本投影,不依赖底层协议;Phase 5 用 curl 验证 |
| LLM 提供商为 OpenAI 兼容中转(非官方 API) | 低 | 用 `new ChatOpenAI({ configuration })` 实例而非字符串 model,绕过 initChatModel 的 provider 解析 |

---

## 7. 回滚策略

- 全程 git 分支 `feat/deepagents-migration`,按 Phase 粒度 commit
- D2-B 保证 `AGENT_MODE=classic` 一行回退旧管线,代码级回滚窗口持续到 Phase 8
- 数据零迁移:ChromaDB collection、data/、conversations.json 均不触碰
- 每个 Phase 结束均可独立回滚(Phase 依赖:1→2→3→4→5,6/7 可跳过但推荐)

---

## 8. 工作量汇总

| Phase | 内容 | 预估 |
|---|---|---|
| 0 | 基线 | 0.5h |
| 1 | 依赖升级 | 0.5~1d |
| 2 | 基础设施适配 | 0.5d |
| 3 | 工具层 | 0.5d |
| 4 | Agent 层(核心) | 1d |
| 5 | API 层 | 0.5d |
| 6 | 测试 | 0.5~1d |
| 7 | A/B 验证 | 0.5~1d |
| 8 | 清理 | 0.5d |
| **合计** | | **4~5.5 天** |

---

## 9. 审查确认清单

- [ ] D1~D8 决策点是否认可(默认值见推荐列)
- [ ] 阶段拆分粒度是否合适
- [ ] 是否有我遗漏的现有功能/调用方(如外部 Web 前端对 /api 的依赖)
- [ ] 确认后我开始 Phase 0
