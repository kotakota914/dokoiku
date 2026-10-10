import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    // 既定は node。コンポーネントのテストはファイル先頭に
    // `// @vitest-environment jsdom` を書く。
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
    setupFiles: ["src/test/setup.ts"],
    env: { DATA_BACKEND: "memory", MEMORY_PERSIST: "off" },
  },
});
