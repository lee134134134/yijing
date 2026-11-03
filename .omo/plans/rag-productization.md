# 倪海厦知识库 RAG —— 产品化改造计划

> 基线版本：v2.1.0（DeepAgent.js 迁移完成）
> 制定日期：2026-11-03
> 依据：代码实测结论（typecheck 通过、126 测试全绿、覆盖率 53.5%、Chroma 停机时 status 仍 200、API 无会话、引用 ID 不稳定、ingest 丢正文、私钥入库）
>
> **已定决策**：前端 **React** ｜ 语料 **43 本全量** ｜ 部署 **单机自用**。
> 因此本计划裁剪了多租户/计费/审计，P2 缩短；P4 扩为 43 本的批量化数据工程，成为最大长尾。

---

## 进度

| 阶段 | 状态 | 说明 |
|---|---|---|
| P0 | ✅ 完成（2026-11-03，tag `p0-secure`） | 代码与测试完成；P0-1 的密钥轮换与 git 历史重写仍待人工 |
| P1 | ⏸ 待启动 | 阻塞：ChromaDB 未运行、当前 `.env` 模型被限流（429）；P1-3/P1-4 可先写代码 |
| P2–P5 | ⏳ 未开始 | |

---

## 0. 目标与非目标

### 目标（按优先级）

1. **可信**：任何回答都能溯源到具体文档/章节；检索失败必须显式失败，绝不静默编造。
2. **可用**：HTTP 侧支持多轮会话；React 前端可独立使用（单机自用，不做多租户）。
3. **可测**：有一套黄金问答集和可重复的指标，任何调参都有 before/after。
4. **可运维**：索引可版本化/回滚；健康检查说真话；故障可定位。

### 明确不做（本计划内）

- 不做多租户、计费、审计日志、key 哈希存储（单机自用）
- 不上微服务、Redis、K8s、图数据库
- 不做多 Agent 蜂群、不做微调
- 不追求"全自动 PDF 理解"，语料工程允许人工校对
- 不重写 DeepAgent 编排骨架（只修流式/预算/取消）

---

## 1. 改造原则

1. **先止血，再增强**：P0 全部是"不修就会产生错误结论"的问题。
2. **先测量，再调参**：没有 eval 基线之前，不改 chunk size、topK、阈值。
3. **失败要响**：所有 `catch → [] / 0` 都是缺陷，改为类型化错误 + 明确降级。
4. **引用是一等公民**：`ref_id` 从检索层产生，贯穿工具 → 模型 → SSE → 前端。
5. **可回滚**：索引按 collection 版本切换；数据库迁移幂等；每阶段一个 commit/tag。

---

## 2. 阶段总览与排期

| 阶段 | 内容 | 日历（人+AI） | 主要瓶颈 |
|---|---|---|---|
| P0 | 安全与可信止血 | 0.5–1 天 | 密钥轮换（人工/外部） |
| P1 | 检索可信度 + Eval | 2–3 天 | 阈值/权重需要人工判断 |
| P2 | 会话模型 + API（单机版） | 2–3 天 | 协议设计与兼容 |
| P3 | React Web 前端 | 3–4 天 | 设计品味与交互细节 |
| P4 | 43 本语料工程（PDF→结构化） | 3–5 周 | OCR 质量 + 人工校对（真正瓶颈） |
| P5 | 运维加固（Docker 可选） | 1–2 天 | 无 |

依赖关系：

```
P0 ──► P1 ──► P2 ──► P3
        │
        └──► P4（可与 P1 并行启动 spike；P1 的最终指标依赖 P4）
P5 任意时间（建议 P2 之后）
```

**P0–P3 合计约 8–11 个日历日**（P2 因单机简化而缩短；人工验收约每天 1–2 小时）。
**P4 是质量上限，单独 3–5 周**：代码 1–2 天、机器 OCR 约一夜、**人工校对 20–40 小时**才是瓶颈。

---

## 3. P0 —— 安全与可信止血（0.5–1 天）

### P0-0 恢复可运行基线（30–60 min）

- 启动 Chroma（`docker compose up -d chromadb` 或本地进程），确认 `/api/v2/heartbeat` 可达
- `.env` 换掉被限流的 free 模型（`glm-5.3-flash-free` 已在 error.log 中连续 429）
- 跑通一条端到端问答，记录：首 token 时间、总耗时、回答、docCount
- 备份：`data/yijing.db`、`chroma_data/`、当前 `.env`
- 验收：`npm run dev -- "桂枝汤的组成"` 能返回带引用的回答

### P0-1 私钥清除（人工，30 min + 等待）

- **轮换 `lee` 对应的 SSH key**（先轮换，再清理仓库）
- `git rm --cached lee lee.pub`，补 `.gitignore`（`lee*`、`*.pem`、`*.key`）
- 若已 push：`git filter-repo --path lee --path lee.pub --invert-paths`，强推并通知协作者重新 clone
- 验收：`git log --all --oneline -- lee` 无输出；旧 key 在目标主机失效

### P0-2 认证与 LLM Key 解耦（单机自用版）

改动：`src/config.ts:235`、`src/api/middleware/auth.ts`、`src/api/server.ts:101`

- `apiKeys` 只读 `API_KEYS`，**删除 `OPENAI_API_KEY` 回退**
- 默认 `API_HOST=127.0.0.1`；回环地址且无 `API_KEYS` → 允许无鉴权启动
- 若 `API_HOST` 不是回环地址且无 `API_KEYS` → **拒绝启动**（避免误暴露到 LAN/公网）
- 401 错误码统一为 `UNAUTHORIZED`（新增 ErrorCode），不再复用 `INVALID_INPUT`
- 验收：本机无 key 可访问；改 `API_HOST=0.0.0.0` 且无 key → 启动失败

### P0-3 `/docs` 可用 + 路由 Schema

改动：`src/api/server.ts`、`src/api/routes/*.ts`

- `/docs`、`/docs/*` 加入鉴权白名单（或改用 Basic Auth，二选一）
- 四个路由补 Fastify JSON Schema：`body`、`response`、`tags`、`security`
- 验收：浏览器打开 `/docs` 能看到 4 个端点、请求体模型和响应示例

### P0-4 限流身份修复（单机可延后到 P5）

改动：`src/api/middleware/rate-limit.ts:45`、`server.ts`（`trustProxy`）

- 认证钩子先执行，`req.auth = { keyId }`；限流按 `keyId ?? ip` 分桶，**删除 `includes(":")`**
- Fastify `trustProxy` 由 `TRUST_PROXY` 配置（默认 false），不再无条件信任 `X-Forwarded-For`
- 验收：IPv4 认证用户得到 1000/min；伪造 XFF 不改变分桶；匿名 iPad 仍 100/min

### P0-5 修复 ingest 丢正文

改动：`src/ingestion/loader.ts:87-158`

- 改为两遍算法：第一遍扫描所有 heading 生成边界索引；第二遍按边界切片。禁止"遇到 H3 直接重置 `currentLines`"
- 短段落合并规则：合并到**父 H2**，而不是丢弃
- 新增测试：`## 证 / 正文 / ### 法`、连续 `###`、无 H2、空文件
- 验收：手写样例中的 `桂枝汤主之` 必须出现在输出中（当前会丢）；`npm test` 绿

### P0-6 检索失败显式化

改动：`src/vectorstore/chroma.ts`、`src/agents/index.ts`、`src/api/routes/status.ts`

- `searchKnowledge` / `searchByDomain`：失败抛 `RetrievalError`，不再 `return []`
- `getDocumentCount` / `listCollections`：改为抛错或返回 `{ ok, value }`
- Agent 层捕获：返回 `degraded: true` + 明确文案（"知识库当前不可用"），不走"没有搜到相关内容"
- `/api/query`：Chroma 不可用 → `503 VECTOR_STORE_UNAVAILABLE`
- `/api/status` 增加 `health: { chroma, embedding, llm }`；新增 `GET /ready`（真实探测）
- 验收：停掉 Chroma 后 `/ready` 503、`/api/query` 503、`/api/status` 显示 `chroma:false`

### P0-7 请求体校验

- `POST /api/query`：`query` 1–2000 字、`stream` boolean
- `POST /api/deep`：`query` 1–2000 字
- 统一 zod（与 agents 层一致）或 Fastify JSON Schema；超限 400
- 验收：10MB 请求体不再直达 embedding

**P0 完成定义**：以上 7 项验收全过；`npm run typecheck && npm test` 绿；打 tag `p0-secure`。

---

## 4. P1 —— 检索可信度 + Eval（2–3 天）

### P1-1 Embedding 切换 + 索引清单

改动：`.env.example`、`src/config.ts`、`新增 src/vectorstore/manifest.ts`

- 默认模型改 `Xenova/bge-small-zh-v1.5`（512 维；CPU 可跑）。备选 `BAAI/bge-m3`（更强但更重）
- 集合 metadata 写入：`{ embedding_model, dim, chunk_size, corpus_hash, built_at, index_version }`
- 启动时校验：模型/维度与集合不一致 → **fail fast**，提示"请重新 ingest"
- 验收：只改 `EMBEDDING_MODEL` 不重建 → 启动报错，而不是静默返回空

### P1-2 相似度分数与阈值

改动：`src/vectorstore/chroma.ts:153`

- `include: ["documents","metadatas","distances"]`；`RetrievedDoc.score` 归一化
- `MIN_SCORE` 可配（先 0.35，按 eval 调）；低于阈值丢弃
- 全部低于阈值 → 返回空并标记 `noAnswer`，由上层给"知识库无此内容"
- 验收：eval 中"知识库无关问题"的假阳性率下降

### P1-3 引用数据化（核心）

改动：`src/rag/citations.ts`（重写现有死代码）、`src/agents/tools.ts`、`src/agents/prompts.ts`、`src/types.ts`、`src/api/routes/query.ts`

- 每个唯一 chunk 分配稳定 `ref_id = sha1(source|h1|h2|content).slice(0,8)`
- 工具输出格式改为 `[ref:abcd1234] 【来源】...`；system prompt 同步改为 `[ref:<id>]`
- `agenticRag` 返回 `citations: Array<{refId, source, h1, h2, h3, lineRange, snippet, score}>`
- 校验：回答中出现的 `ref:` 必须命中本次检索集合；未命中的引用在 `citations` 中标记 `invalid`
- `/deep`：模型的 `references[]` 用本次检索集合回填；命中不到 → 丢弃该项并把 `confidence` 上限压到 0.6
- 验收：任意回答的每个引用都能在前端定位到 `source + h2`；`docCount` 改为唯一文档数

### P1-4 混合检索（dense + BM25）

改动：`新增 src/vectorstore/fts.ts`、`ingestion/index.ts`、`config.ts`

- 用现有 better-sqlite3 建 FTS5 表（已验证 FTS5 可用）
- 中文处理：写入/查询前做 **bigram 分词**（`桂枝汤` → `桂枝 枝汤`），`unicode61` 直接匹配整句会失效
- dense top20 + bm25 top20 → RRF 融合 → 取 topK
- `ENABLE_HYBRID=true` 默认开启（可用配置关闭做 A/B）
- 验收：eval recall@5 相对提升 ≥ 15%

### P1-5 去重与多样性

- 同一 `source + h2` 最多保留 2 块；跨工具调用按 `ref_id` 去重
- 可选 MMR（λ=0.7），先不默认开
- 验收：单次回答的引用来源数 ≥ 2（当语料确实跨章节时）

### P1-6 Eval Harness（必须先于调参）

新增：`eval/golden.jsonl`、`eval/run.ts`、`eval/report.md`

- 字段：`id, question, expected_sources[], must_include[], must_not_include[], should_answer: boolean`
- 首批 50 条：人工写 20 条（你/领域人），AI 从语料生成 30 条并**人工审核**
- 指标：recall@5、MRR、引用准确率、无答案准确率、首 token p50/p95
- `npm run eval` 输出 JSON + Markdown；结果提交到仓库，作为基线
- 验收：有 before/after 表格，后续所有检索改动必须附 eval 结果

### P1-7 Rerank（可选，仅当 eval 证明有收益）

- `src/rag/rerank.ts`：先用低成本模型对 top20 重排，验证收益
- 有收益再考虑本地 cross-encoder；无收益则删除 `enableReranking` 死配置
- 验收：recall@5 或引用准确率提升 ≥ 5%，否则不合并

**P1 完成定义**：eval 报告有基线；`MIN_SCORE/HYBRID/embedding` 三项都通过 eval 决策；引用可解析率 100%；打 tag `p1-retrieval`。

---

## 5. P2 —— 会话模型 + API（单机版，2–3 天）

> 单机自用：不做 owner 隔离、配额、审计；**会话是唯一隔离维度**。若将来开放给他人，再补 owner_key。

### P2-1 数据库 schema v2

`src/conversation/store.ts` + `src/conversation/migrations.ts`

```sql
schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER)

conversations(
  id TEXT PRIMARY KEY, title TEXT,
  created_at INTEGER, updated_at INTEGER, deleted_at INTEGER
)

messages(
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL, content TEXT NOT NULL,
  query_type TEXT, doc_count INTEGER, citations_json TEXT, degraded INTEGER,
  model TEXT, latency_ms INTEGER, created_at INTEGER
)
CREATE INDEX idx_messages_conv ON messages(conversation_id, created_at);
```

- 迁移幂等；启动时自动执行；旧 `conversations` 表数据可选迁移为"legacy"会话
- 验收：旧库可直接启动，数据不丢

### P2-2 会话 API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/conversations` | 新建（可带 title） |
| GET | `/api/conversations?cursor=&limit=` | 列表（按更新时间倒序） |
| PATCH | `/api/conversations/:id` | 重命名 |
| DELETE | `/api/conversations/:id` | 软删 |
| GET | `/api/conversations/:id/messages?cursor=` | 消息分页 |

- 会话之间互不串扰；`DELETE` 只影响指定会话
- 验收：连续创建 3 个会话，消息不互相污染；删除后列表与消息均不可见

### P2-3 查询接入会话

- `POST /api/query { query, conversationId?, stream? }`
- 无 `conversationId` → 自动建会话并在 `meta` 中返回
- 落库 user + assistant（含 citations、queryType、docCount、latency、model、degraded）
- history 取该会话最近 6 条（3 轮），传入 `agenticRag`
- 验收：HTTP 连续两轮能引用上一轮内容；刷新后历史仍在

### P2-4 SSE 协议 v2

```
event: meta      data: {conversationId, messageId, queryType, ...}
event: token     data: {text}
event: citation  data: {refId, source, h2, snippet}
event: done      data: {response, citations[], docCount, elapsed, degraded}
event: error     data: {code, message}
id: <seq>        （为断线续传预留）
```

- 心跳保留（25s）
- `reply.hijack` 后的异常也走同一协议
- 验收：协议有文档 + 前端联调通过；断线不产生半条脏消息

### P2-5 取消、超时、预算

- `agent.streamEvents(..., { signal })`（类型已支持，删掉"deepagents 不支持"的注释）
- `REQUEST_TIMEOUT_MS`（默认 120s）→ abort → `LLM_TIMEOUT`
- `MAX_TOOL_CALLS`（默认 6）在工具包装层计数，超限返回"检索次数已用完，请基于现有资料回答"
- `MAX_CONTEXT_TOKENS` 真正接入：对工具输出做预算裁剪（或删掉 `context-manager.ts` 死代码）
- 验收：客户端断连后日志出现 abort；100 次迭代无法触发；单请求 LLM 调用数可观测

### P2-6 流式修复

- 只把**最后一条 AI 消息**的 token 推 `token`；中间消息推 `thinking`（前端可折叠）或不推
- 兜底逻辑不再向流中追加文本：改为 `done.degraded=true`，由前端提示
- 验收：流式输出的文本 === `done.response`（除 thinking 外）

### P2-7 测试补齐

- `api-conversations`、`api-deep`、`api-history`、SSE 协议、abort、并发写入
- 覆盖率门禁 ≥ 60%（`vitest --coverage` + CI 检查）
- 验收：CI 全绿，覆盖率达标

**P2 完成定义**：HTTP 多轮可用、会话隔离、可取消、SSE 契约稳定；打 tag `p2-api`。

---

## 6. P3 —— React Web 前端（3–4 天）

### P3-1 选型（已定：React）

- **React 19 + Vite + Tailwind + shadcn/ui**（沿用旧计划技术栈）
- 新增：`react`、`react-dom`、`@vitejs/plugin-react`、`react-markdown`、`zustand`（状态用 zustand，别引 Redux）
- 复用现有 Biome：把 `web/` 纳入 `biome.json` 的 include，不引入第二套 lint
- TUI 仍是 Vue，但它是独立构建（`vite.tui.config.ts`），与 `web/` 互不影响
- 新增脚本：`dev:web`、`build:web`、`typecheck:web`（`tsc -p web/tsconfig.json --noEmit`），全部并入 CI

### P3-2 结构

```
web/
  src/api/client.ts        # fetch + SSE 解析（不用 EventSource：需要 POST + header）
  src/api/sse.ts           # ReadableStream → 事件解析 + AbortController
  src/stores/chat.ts       # zustand：会话/消息/流式状态
  src/components/ui/       # shadcn 基础件
  src/components/          # MessageList, Composer, CitationPanel, HealthBadge
  src/views/               # Chat, Deep, History, Status
```

### P3-3 功能

- Chat：流式（`react-markdown` 渲染）、停止生成（AbortController）、引用侧栏（点击定位到 snippet）、免责声明常驻
- 引用渲染：把 `[ref:id]` 替换为可点击上标，点击打开 `CitationPanel`；`invalid` 引用标红
- Deep：结论/推理/建议/引用四块；低 confidence 显式提示
- History：会话列表、重命名、删除、分页
- Status：`/ready` 健康、索引版本/模型/文档数
- 四态：loading / empty / error / degraded

### P3-4 部署（单机）

- `npm run build:web` 产物由 Fastify `@fastify/static` 托管到 `/`，SPA fallback 到 `index.html`
- 开发期 Vite proxy 到 `:3001`；`CORS_ORIGIN` 仅开发使用
- 一条命令启动：`npm run build:web && npm run server`（可加 `start:all` 脚本）
- 验收：浏览器打开 `http://127.0.0.1:3001` 直接可用，不需要第二个进程

### P3-5 E2E

- Playwright 冒烟 3 条：提问→流式→引用；新建会话；deep 分析
- 验收：CI 跑通（可 nightly）

**P3 完成定义**：产品可演示、可给非技术用户使用；打 tag `p3-web`。

---

## 7. P4 —— 43 本语料工程（3–5 周，可与 P1 并行启动）

> 这是回答质量的上限。当前 `memory/` 只有 143KB 摘要，`pdf/` 有 43 个文件、1.2GB。
> 目标：把 PDF 变成可引用到 `book + page` 的结构化语料，并与现有摘要层共存。

### P4-0 语料台账（2–4 小时，第一步）

新增 `corpus/manifest.yaml`，逐本登记：

```yaml
- id: shanghanlun
  title: 伤寒论
  author: 张仲景（倪海厦讲解）
  edition: 人纪系列
  pdf: pdf/0611/倪海厦人纪系列之伤寒论.pdf
  pages: 0            # spike 后填
  text_layer: unknown # yes/no
  scope: core         # core | reference | exclude
  duplicate_of: null
```

- 43 本里有大量重复版本（滴天髓至少 8 个版本）：**同书只保留 1–2 个权威版本，其余 `duplicate_of` 不入库**
- `scope` 区分：倪海厦原著/讲解 = `core`；传统典籍（滴天髓、麻衣神相）= `reference`；无法确权/质量差的 = `exclude`
- AI 可根据文件名起草台账，但 **edition / scope / 版权必须人工确认**

### P4-1 Spike（2–4 小时）

- 抽样 10 本（含"扫描版"标注的），判定文字层比例
- 本机当前没有 `pdftotext`/`pypdf`/`pymupdf`，需先装工具
- 决策：文字层用 `pdfjs-dist`/`pdftotext`；扫描件用 `ocrmypdf + tesseract(chi_sim)` 或 PaddleOCR
- 产出：`docs/pdf-ingest-spike.md`（文字层比例、每本耗时、OCR 总时长估算）

### P4-2 解析管线（独立于运行时，可断点续跑）

```
tools/pdf2md/
  extract.ts     # PDF → 页级文本 + 坐标（文字层）
  ocr.ts         # 扫描页 → 文本（按页缓存，失败可重试）
  structure.ts   # 书/章/节/页码识别，页眉页脚去除
  normalize.ts   # 断行合并、脚注、全半角；繁体保留原文，另生成简体检索字段
  emit.ts        # corpus/<book>/<chapter>.md + front-matter
  qa.ts          # 页数校验、空页率、字符异常率、抽样对比
```

- 每本书一份结构模板 `corpus/config/<book>.yaml`（卷/章/条文编号规则），43 本书结构不统一
- 输出 front-matter：`book, chapter, section, page_start, page_end, source_pdf, edition`
- 繁体书保留原文用于引用，用 OpenCC 生成简体 `search_text` 供检索（避免"张锡纯/張錫純"召回断裂）
- **断点续跑**：按 PDF 哈希 + 页号缓存中间结果，中断不重来
- 先跑通 3 本（伤寒论、金匮要略、针灸）验证模板，再批量 43 本

### P4-3 分块与两层语料

- **两层语料**：`curated`（现有 143KB 摘要，用于概览/导读）+ `fulltext`（43 本正文，用于条文/剂量/医案细节）
- 检索默认合并两层，同分时 `curated` 优先；`/deep` 可显式指定层
- **small-to-big**：子块 400–600 字（检索），父块 = 小节（生成），命中子块后展开父块
- 伤寒论/金匮按**条文号**切块，其余按章节切块（由 `corpus/config/<book>.yaml` 驱动）
- metadata：`book / chapter / section_path / page_start / page_end / layer`
- 验收：细节类问题（条文、剂量）引用能定位到页码

### P4-4 非破坏性 ingest

- 写入 `yijing_knowledge_v{n}`，校验 `count` + 抽样查询通过后，更新 `index_manifest.active_collection`
- 失败保留旧集合；`npm run ingest -- --collection v3`
- 运行中的服务通过 manifest 解析当前集合（带 60s 缓存）
- 验收：ingest 中途 kill 进程，服务仍可查询旧索引

### P4-5 增量更新

- `id = sha256(source_path + section_path)`；`upsert`；源文件删除则删对应 id
- `npm run ingest -- --changed` 只处理 mtime/hash 变化的文件
- 验收：改一个 md，只重算该文件的块

### P4-6 私有数据隔离

- `jiapu.md` 移出公共集合，或加 `visibility: private` 并在检索时强制过滤
- 验收：公共查询永远不返回家谱内容（加测试）

### P4-7 逐本 QA 门禁

每本书入库前必须过：

- 页数覆盖 ≥ 98%（缺页检测）
- 抽样 10 页与原文对照，字符错误率 ≤ 2%
- 目录/章节数与 PDF 书签或人工目录一致
- 抽查 20 条检索，至少 16 条命中正确书/章

产出 `corpus/qa/<book>.md`，不过关不进索引。

### P4-8 版权与范围

- 确认 `pdf/` 资料的可商用范围；不可商用则仅本机自用，不对外提供服务
- `scope: exclude` 的书目永不入库；`reference` 层在引用中明确标注"非倪海厦原文"

**P4 完成定义**：43 本台账完成、`core` 全部入库、`reference` 按需入库；索引来源可追溯到 `book + page`；eval recall@5 ≥ 0.8；ingest 可回滚。

---

## 8. P5 —— 运维加固（1–2 天）

- **Node 24 LTS**（替换 26）：`engines`、`.nvmrc`、CI、Dockerfile 同步
- **日志轮转**：`pino-roll`（按天/100MB），`LOG_LEVEL` 默认 `info`；脱敏补 `x-api-key`
- **指标**：`/metrics`（prom-client）：请求数、延迟分位、LLM 调用/token、检索命中、降级次数
- **Docker（单机可选）**：本机直接 `npm run server` + 本地 Chroma 即可；若要用容器：
  - Chroma 固定版本（与 `chromadb` 3.5 匹配），healthcheck 改 `/api/v2/heartbeat`
  - `api` 服务补 `API_KEYS`、`LLM_PROVIDER`、`LLM_DEEP_*`、`EMBEDDING_MODEL`
  - 非 root 用户、`HEALTHCHECK`、`restart: unless-stopped`
- **CI**：`lint` 覆盖 `tui/` 与 `web/`；新增 `typecheck:web` / `build:web`；coverage 阈值；nightly `eval`
- **死代码**：`context-manager.ts`、`citation.ts` 旧实现、`withRetry/withTimeout`、`cleanQuery`、`enableReranking`、`StreamChunk` —— 接线或删除

---

## 9. 验收指标（Definition of Done）

| 维度 | 指标 | 目标 |
|---|---|---|
| 检索 | recall@5（golden 100–150 条） | ≥ 0.80 |
| 检索 | 逐书 recall@5（core 书目） | ≥ 0.75 |
| 检索 | 无关问题假阳性率 | ≤ 10% |
| 引用 | 引用可解析率（ref 命中检索集合） | 100% |
| 引用 | 引用准确率（引用内容确实支持结论） | ≥ 0.95（人工抽检 50 条） |
| 可靠性 | Chroma 故障时的显式失败率 | 100%（0 次静默编造） |
| 语料 | core 书目入库率 | 100% |
| 语料 | 逐本 QA 门禁通过率 | 100%（不过门禁不入库） |
| 会话 | 会话间消息隔离 | 100% |
| 性能 | 首 token p50 / p95 | < 3s / < 8s（稳定模型） |
| 性能 | 完整回答 p95 | < 30s |
| 成本 | 单次请求 LLM 调用数 | ≤ 4（默认配置） |
| 工程 | 覆盖率 | ≥ 60% |
| 工程 | CI | lint/typecheck/test/build 全绿 |

---

## 10. 回滚策略

- 每阶段一个 tag：`p0-secure` → `p1-retrieval` → `p2-api` → `p3-web` → `p4-corpus`
- 数据库：迁移前 `cp data/yijing.db data/yijing.db.bak-<date>`；迁移只加表不改旧表
- 索引：`index_manifest.active_collection` 切回上一版本即可（P4 后）
- 配置：`.env` 纳入备份，但**永不入库**

---

## 11. 已定决策与影响

| 决策 | 影响 |
|---|---|
| 前端 **React** | P3 采用 React 19 + Vite + Tailwind + shadcn/ui；新增 `web/` 与 `typecheck:web`，Biome 覆盖 `web/` |
| 语料 **43 本全量** | P4 增加台账、去重择版、OCR、逐本 QA；长尾 3–5 周，必须尽早启动 |
| 部署 **单机自用** | P2 去掉 owner 隔离/配额/审计；默认绑 `127.0.0.1`；Docker 降为可选 |

仍然保留的"将来再说"：多租户、计费、分布式限流、Redis 缓存。
将来若要开放，只需给 `conversations` 加一列 `owner_key` + 鉴权层补 key 映射，数据模型不需要重做。

---

## 12. 建议的第一周

| 天 | 事项 |
|---|---|
| D1 | P0-0 恢复环境 + P0-1 轮换密钥 + P0-2/3 认证与文档 |
| D2 | P0-5 ingest 修复 + P0-6 失败显式化 + P0-7 校验，打 tag |
| D3 | P1-1 embedding 切换 + P1-2 阈值 + 建 eval 基线 |
| D4 | P1-3 引用数据化 + P1-4 混合检索 |
| D5 | P1-6 eval 复跑 + 调参 + 记录报告 |
| 并行 | **P4-0 台账 + P4-1 PDF spike（当天做，结果决定 P4 总工期）** |
| 夜间 | OCR 批处理（装好工具后即可跑，不占人手） |
