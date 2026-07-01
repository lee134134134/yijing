# 倪海厦知识库 - 产品化升级方案

**Goal**: 将 CLI 工具升级为完整的 Web 应用产品（Web UI + REST API + 向量数据库 + 可视化 + 生产级工程）
**Strategy**: 集中一个 PR，分模块并行实施，后端→API→前端 流水线依赖

---

## Architecture 总览

```
web/ (React + Vite + Tailwind)         ← 新增：Web 前端
  │
  │ HTTP + SSE
  ▼
src/api/ (Fastify)                     ← 新增：REST API 服务层
  │
  ├──→ src/rag/agents/                 ← 增强：流式输出
  │       │
  │       ▼
  ├──→ src/vectorstore/chroma.ts       ← 重写：ChromaDB 替代 n-gram
  │       │
  │       ▼
  │     ChromaDB (本地进程)            ← 新增：真实向量数据库
  │
  ├──→ src/conversation/store.ts       ← 重写：SQLite 替代 JSON 文件
  │
  ├──→ src/logger.ts                   ← 新增：pino 结构化日志
  │
  └──→ Dockerfile/docker-compose.yml   ← 新增：容器化部署
```

---

## 模块拆分与实施顺序

### 第一波（独立模块，可并行部署）

| # | 任务 | 文件范围 | 输出 | 估算 |
|---|------|----------|------|------|
| A1 | ChromaDB 向量存储重写 | `src/vectorstore/chroma.ts` | `chromadb` + `@langchain/community` 集成，embedding 语义搜索替代 n-gram | M |
| A2 | SQLite 对话存储 | `src/conversation/store.ts` | `better-sqlite3` 替代 JSON 持久化 | S |
| A3 | 结构化日志系统 | `src/logger.ts` | pino 日志，替代 console.log | XS |
| A4 | 数据迁移脚本 | `src/vectorstore/migration.ts` | 迁移旧 documents.json → ChromaDB | S |
| A5 | 配置扩展 | `src/config.ts` | 新增 ChromaDB/SQLite/API 配置项 | XS |

### 第二波（依赖第一波）

| # | 任务 | 文件范围 | 输出 | 估算 |
|---|------|----------|------|------|
| B1 | Fastify API Server | `src/api/server.ts`, `src/api/routes/*.ts` | REST API + SSE 流式输出 | M |
| B2 | 引擎流式输出增强 | `src/agents/index.ts` | 支持 stream 模式，分块返回 | M |
| B3 | /deep 深度分析 API | `src/api/routes/deep.ts` | 深度分析 endpoint | S |

### 第三波（依赖第二波 + 独立）

| # | 任务 | 文件范围 | 输出 | 估算 |
|---|------|----------|------|------|
| C1 | Web UI 项目初始化 | `web/` | Vite + React + Tailwind + shadcn/ui | S |
| C2 | 聊天界面 | `web/src/components/ChatView.tsx` | 消息列表 + 流式展示 + 查询类型标签 | L |
| C3 | 深度分析页 | `web/src/components/DeepAnalysis.tsx` | 结构化结论/推理/引用展示 | M |
| C4 | 历史记录页 | `web/src/components/HistoryView.tsx` | 按时间/类型筛选 | M |
| C5 | 状态仪表盘 | `web/src/components/Dashboard.tsx` | 知识库统计图表 | M |

### 第四波（可视化 + 运维，可与第三波并行）

| # | 任务 | 文件范围 | 输出 | 估算 |
|---|------|----------|------|------|
| D1 | 八字排盘可视化 | `web/src/components/BaziChart.tsx` | 四柱八字表格 | L |
| D2 | 卦象可视化 | `web/src/components/GuaView.tsx` | 六爻卦画展示 | M |
| D3 | Docker 化 | `Dockerfile`, `docker-compose.yml` | API + ChromaDB + SQLite 容器编排 | S |
| D4 | 测试覆盖提升 | `src/__tests__/*.test.ts` | API 测试 + 核心函数测试 | M |
| D5 | 错误体系 | `src/errors.ts` | 自定义错误类 + 错误码 | S |

---

## 关键接口设计

### REST API

```
POST /api/query        — 普通查询（支持 SSE stream）
  Body: { query: string, stream?: boolean }
  Response: { response, queryType, docCount, elapsed }

POST /api/deep         — 深度分析
  Body: { query: string }
  Response: { conclusion, reasoning, references, confidence, suggestions }

GET /api/history       — 对话历史
  Query: { limit, type }
  Response: [{ id, role, content, queryType, timestamp }]

DELETE /api/history    — 清除历史

GET /api/status        — 知识库状态
  Response: { docCount, model, collections }
```

### Vectorstore 接口（保持不变，内部实现换 ChromaDB）

```typescript
searchKnowledge(query, topK) → KnowledgeDocument[]
searchByDomain(query, domain, topK) → KnowledgeDocument[]
```

---

## 依赖关系

```
A1 ──→ B1 ──→ C1/C2/C3/C4/C5
A2 ──→ B1 ──→ (都跟 C 并行)
A3 ──→ B1
A4 ──→ A1
A5 ──→ (被所有人依赖)
                D1 ──→ C1
                D2 ──→ C1
                D3 ──→ B1
                D4 ──→ (贯穿周期)
                D5 ──→ (贯穿周期)
```

---

## 执行策略

1. **第一波（A1-A5）**：并行 5 个 `deep` agent，互不阻塞
2. **第二波（B1-B3）**：等待 A 完成后，并行 3 个 agent
3. **第三、四波（C1-C5, D1-D5）**：等待 B 完成后，全部并行
4. **最后整合**：数据迁移、端到端测试、Docker 构建验证

## 成功标准

- [ ] ChromaDB 集成通过检索准确性测试（对比旧 n-gram 提升）
- [ ] API 所有端点返回正确数据
- [ ] Web UI 可完成完整的查询→展示流程
- [ ] 所有测试通过（含新增）
- [ ] Docker 构建成功，`docker compose up` 可一键启动
- [ ] 日志系统正常工作
- [ ] 旧数据可迁移到新存储
