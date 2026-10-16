import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vueTermui from "vue-termui/vite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const tuiDir = join(__dirname, "tui");

/**
 * Vite 构建配置 —— 用于 vue-termui 终端 TUI（子工程 tui/）。
 *
 * 产物输出到 dist-tui/，与主程序 tsc 产物 dist/ 完全隔离。
 *
 * 构建采用 SSR 模式：
 * - 所有 node_modules 顶层依赖在运行时从 node_modules 解析（避免打包
 *   better-sqlite3 / transformers / onnxruntime 等原生或 WASM 模块）。
 * - `@opentui/core`（vue-termui 底层 FFI）由插件特别 external。
 */
export default defineConfig({
  root: tuiDir,
  plugins: [vueTermui({ entry: "/src/main.ts" })],
  resolve: {
    // TUI 内部以绝对虚拟路径引用主程序源码，避免深层相对路径
    alias: {
      "@app": join(__dirname, "src"),
    },
  },
  build: {
    outDir: join(__dirname, "dist-tui"),
    emptyOutDir: true,
    ssr: true,
    target: "node26",
  },
});