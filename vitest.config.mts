import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
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
