import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // build 产物(dist/) 中的 *.test.js 不应被测试收集器二次扫描
    exclude: ["dist/**", "node_modules/**"],
  },
});
