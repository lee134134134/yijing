/**
 * vue-termui TUI 启动入口。
 *
 * - `createApp` 为异步：内部初始化 OpenTUI（原生 FFI）渲染器并装配 Vue 自定义
 *   渲染器。
 * - 用户按 Ctrl+C（exitOnCtrlC）或输入 `/exit`（组件内 useExit()）时退出，
 *   `app.waitUntilExit()` 会一直等到渲染器销毁、终端恢复后 resolve。
 */
import { createApp } from "vue-termui";
import App from "./App.vue";

async function main(): Promise<void> {
  // 第三个参数为 OpenTUI 渲染器配置：开启 Ctrl+C 直接退出。
  const app = await createApp(App, undefined, { exitOnCtrlC: true });
  app.mount();
  await app.waitUntilExit();
}

process.on("SIGINT", () => {
  // 兜底：非终端信号下也能安全退出（渲染器销毁幂等）。
  process.exit(0);
});

main().catch((err: unknown) => {
  console.error("Fatal:", err);
  process.exit(1);
});
