import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // cacheComponents（PPR）は使わない。ほぼ全ページが動的データなので、従来どおり
  // リクエスト時レンダリングに統一して実装を単純にする（docs/decisions.md 参照）。
  cacheComponents: false,
  turbopack: {
    // 親フォルダに別の package-lock.json があっても、このフォルダをワークスペースの基準にする
    // （Next.js が「ignored package-lock.json ... outside the current Git repository」と警告するのを防ぐ）
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Playwright の E2E で使うため、ヘッダーに X-Powered-By を出さない
  poweredByHeader: false,
};

export default nextConfig;
