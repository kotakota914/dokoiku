import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // cacheComponents（PPR）は使わない。ほぼ全ページが動的データなので、従来どおり
  // リクエスト時レンダリングに統一して実装を単純にする（docs/decisions.md 参照）。
  cacheComponents: false,
  turbopack: {
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
