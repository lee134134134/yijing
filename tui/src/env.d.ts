/// <reference types="vite/client" />

/**
 * vue-termui TUI 的 Vue SFC 类型声明。
 *
 * 让 vite/tsc 能把 `.vue` 当作模块解析；具体组件类型由
 * `@vitejs/plugin-vue` 在构建期产出。
 */
declare module "*.vue" {
  import type { DefineComponent } from "vue";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component: DefineComponent<Record<string, any>, Record<string, any>, any>;
  export default component;
}
