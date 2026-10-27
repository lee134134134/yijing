# 运行环境加固计划(2026-09-18)

> 状态: **完成** (2026-09-18)
> 背景: 上次会话完成 TUI 迁移(React/Ink → vue-termui)与后端全量整改。本次针对评审发现的部署/合规硬伤做确定性修复。
> 决策(已由用户确认, 2026-09-18):
> - 产品形态: **仅终端 TUI + API**, 不新建 Web 前端
> - Node 版本统一: **API 镜像升到 node:26-alpine** (彻底消除 engines >=26.3 与 node:22 的矛盾)
> - 合规: **一并补 .env.example 双写缺口**(EMBEDDING_BASE_URL / EMBEDDING_API_KEY / ENABLE_TODO_PLANNING)

---

## 问题清单

### P1 硬伤 — Node 版本声明与 Docker 镜像矛盾
- `package.json` engines 要求 `>=26.3.0`(为 vue-termui)
- `Dockerfile` builder + runner 均用 `node:22-alpine` → `npm ci` 在 node:22 上 engines 不满足(默认警告;CI 若 engine-strict 直接失败), 声明与镜像严重脱节
- 已核实: `node:26-alpine` 官方标签存在(当前 26.8.2); Node 26 仍是 Current(2026-10-28 转 LTS)
- 原生模块: `better-sqlite3` v12.11.x 有 Node26+musl 预编译; `@opentui/core`(仅 TUI 用)有 `-linux-x64-musl`/`-arm64-musl` 分发包; **Docker 只跑 API 不跑 TUI**, 无 FFI 运行顾虑
- 注意 Docker 构建用 `--ignore-scripts`, 依赖预编译 vs runtime ABI 匹配; API 侧 better-sqlite3 预编译在 26+alpine 对齐, 风险低

### P2 残留 — tsconfig.json 残留 React 配置
- 第 17-18 行 `"jsx": "react-jsx"` + `"jsxImportSource": "react"`
- React/Ink 依赖已移除; `src/` 下已无 `.tsx`(旧 TUI 已删), 当前 tsc 不报错但有隐患: 一旦未来加 React/TSX 文件会连锁失效

### P3 合规 — .env.example 与 config.ts 双写缺口
- `config.ts` 读取 `EMBEDDING_BASE_URL` / `EMBEDDING_API_KEY` / `ENABLE_TODO_PLANNING`
- `.env.example` 无对应注释 → 违反 AGENTS.md "新环境变量必须双写"

---

## 任务清单

- [x] T1 决策确认(产品形态 / Node 方案 / .env 补齐) —— 2026-09-18
- [x] T2 Dockerfile: builder + runner 镜像 `node:22-alpine` → `node:26-alpine`
- [x] T3 检查 docker-compose.yml 是否需同步 —— compose 用 `build:` 指向 Dockerfile、不直接指定 node 镜像 tag, **无需修改**
- [x] T4 tsconfig.json: 删除 `jsx` / `jsxImportSource` 残留
- [x] T5 `.env.example`: 补 `EMBEDDING_BASE_URL` / `EMBEDDING_API_KEY` / `ENABLE_TODO_PLANNING` 注释(对照 config.ts 全部 30 变量逐一核验齐全)
- [x] T6 全量验证: `typecheck` ✓ + `typecheck:tui` ✓ + `test`(56 passed) ✓ + `lint` ✓(3 既有无关警告) + `build` ✓ + `build:tui` ✓
- [x] T7 收尾: 复查改动范围(Dockerfile / tsconfig.json / .env.example 三处), 变更说明整理完毕

---

## 风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| Docker 构建在 node:26-alpine 上 `npm ci --ignore-scripts` 后 better-sqlite3 预编译 ABI 不匹配 | 低 | v12.11.x 已含 Node26+musl 预编译; CI 冒烟 `node dist/api/server.js --health` 或本机验证 build |
| 删除 tsconfig jsx 影响未知文件 | 极低 | `src/` 无 .tsx, 改后跑 typecheck 立即验证 |
| .env.example 注释遗漏 | 低 | 对照 config.ts 全部读取变量逐一核对 |

## 验证门禁
- 提交前本地 `npm run typecheck && npm test && npm run lint`(AGENTS.md 最小门禁) + `npm run build` + `npm run build:tui`
- CI 链条(已改 node 26 + 加 TUI 步骤)应保持绿灯