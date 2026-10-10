# 旅行どこいこう（dokoiku）開発規則

このディレクトリは `docs/要件定義書.md` を実装する Next.js アプリです。リポジトリ直下の `AGENTS.md` より、このファイルを優先します。

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 1. 確定事項（要件定義書 15章の回答）

すべて「推奨」を採用した。詳細は `docs/decisions.md`。

| Q | 決定 |
| --- | --- |
| Q1 | B：MVP＋行きたい場所リスト＋経路作成までをデモ対象。検索・いいね・共有・通報も API と画面は実装するが優先度は低い |
| Q2 | Next.js 16（App Router）＋TypeScript＋Tailwind v4＋lucide-react＋MapLibre GL JS＋OpenFreeMap＋Supercluster＋Supabase＋OpenRouteService＋Vercel |
| Q3 | ADR-0009 / 0010 / 0011 を承認 |
| Q4 | B：Supabase 容量 80% で新規投稿（アップロード）だけ停止、閲覧は続ける |
| Q5 | A：徒歩・車のみ。各区間に Google マップ（公共交通）リンク |
| Q6 | A：自前DB優先＋Nominatim（検索ボタン押下時のみ、1秒1回） |
| Q7 | A：GPS 誤差 100m 未満なら新規スポットを作れる。半径 50m 内の似た名前は 409 で既存を提案 |
| Q8 | A：Google ログインのみ |
| Q9 | カテゴリ 5 種、標準滞在時間は現案 |
| Q10 | A：営業時間は MVP では扱わない（`opening_hours` 列は残し、値があれば経路計算で判定する） |
| Q11 | 通常 1〜4 / 人気 5〜19 / 大人気 20 以上 |
| Q12 | ライトのみ、日本語のみ、昼食休憩は `coffee`、メインカラーは仮に空色（`globals.css` の `--color-primary`） |
| Q13 | 通報 3 件で自動非表示。管理画面は作らず管理 API のみ |
| Q14 | Discord Webhook（`NOTIFY_WEBHOOK_URL`）。未設定ならサーバーログのみ |
| Q15 | 非公開リポジトリ想定 |
| Q16 | 初期データは京都市内 40 スポット前後（memory モードの seed、supabase の seed.sql） |
| Q17 | B 相当：URL は `/spots/[spotId]`。スマホでは地図の上に全画面シート風に表示し、戻ると地図へ。地図の位置は URL ハッシュで保持 |

追加の設計判断：
- `cacheComponents` は使わない（ほぼ全ページ動的）。
- データ保存先は `DATA_BACKEND=memory|supabase` で切り替える。memory モードは Supabase なしで動き、開発・デモ・テストに使う。
- 外部 API が未設定なら代替動作（移動時間は直線距離×係数、場所検索は自前DBのみ）。画面には「概算」「外部検索は利用できません」と明示する。

## 2. ディレクトリ構成

```
src/app/                 画面と Route Handler（/api/v1/**）
src/components/ui/       UI 部品（Button, Card, Badge, Sheet, Toast, Input, Select, EmptyState, ErrorMessage, Spinner, Icon）
src/components/<feature>/ 機能ごとの部品（map, post, spot, list, plan, auth, layout）
src/lib/domain/          定数と型（契約）
src/lib/validation/      zod スキーマ（契約。クライアント・サーバー共用）
src/lib/repo/types.ts    Repository インターフェース（契約）
src/lib/repo/memory/     Memory 実装（.data/ に JSON 保存、開発用アップロードは /api/dev/**）
src/lib/repo/supabase/   Supabase 実装
src/lib/auth/            getCurrentUser / requireUser / requireAdmin
src/lib/api/             route() ラッパー、ApiError、parseBody/parseQuery、ブラウザ用 api クライアント、カーソル、レート制限
src/lib/external/        OpenRouteService、Nominatim、無料枠管理（usage）、通知
src/lib/planner/         経路作成ロジック（純粋関数。外部 API を直接呼ばない）
src/lib/utils/           geo / time / id
supabase/migrations/     SQL（テーブル、PostGIS、RLS、関数）
supabase/seed.sql        初期データ
scripts/                 検証・運用スクリプト
e2e/                     Playwright
docs/                    要件定義書、decisions.md、setup.md
```

## 3. 契約ファイル（勝手に変えない）

次のファイルは複数の担当が同時に依存する。変更が必要なら、最小限の追加にとどめ、作業報告に「契約変更」として明記する。既存の名前・型を変えない。

- `src/lib/domain/constants.ts`、`src/lib/domain/types.ts`
- `src/lib/validation/schemas.ts`
- `src/lib/repo/types.ts`、`src/lib/repo/index.ts`
- `src/lib/auth/server.ts`、`src/lib/api/*`、`src/lib/supabase/*`、`src/lib/config.ts`
- `src/app/globals.css`（トークンの追加は可。既存の名前は変えない）
- `package.json`（依存の追加は統合担当だけが行う）

## 4. 実装ルール

### Next.js 16
- `params` / `searchParams` / `cookies()` / `headers()` は Promise。必ず `await` する。
- Route Handler は `src/lib/api/handler.ts` の `route()` で包み、入力は `parseBody` / `parseQuery` と zod で検証する。エラーは `ApiError` を throw する。
- 型は `{ params: Promise<{ spotId: string }> }` のように明示する（`RouteContext` 型は typegen 後にしか使えない）。
- middleware ではなく `src/proxy.ts`。
- サーバー専用モジュールは `import "server-only"`。ブラウザ部品は先頭に `"use client"`。
- 日時・ランダムは `src/lib/utils` を使う。

### データアクセス
- 画面・API は必ず `await getRepo()`（`src/lib/repo`）を通す。画面や API から supabase-js を直接呼ばない（Google ログイン開始の `signInWithOAuth` だけ例外）。
- 権限（本人かどうか）は API 側で確認する。Repository は確認しない。
- 状態遷移・業務ルール（上限、重複、停止中）は API 側で `ApiError` にする。

### API
- ベースパス `/api/v1`。レスポンスの形は `src/lib/domain/types.ts` の型に合わせる。
- エラー形式と HTTP コードは要件定義書 9.1。
- ログイン必須は `requireUser()`、本人確認は取得したリソースの `userId` と比較して 403。

### 画面（要件定義書 8章）
- アイコンは `lucide-react` のみ。**絵文字は使わない**（文言・トースト・プレースホルダー・初期データ・エラーメッセージを含む）。アイコン名は 8.1 の対応表に従う（`src/components/ui/icons.tsx` の `Icon` を使う）。
- **`border-l-4` などの片側だけの色帯を使わない。** カードは四辺 1px の淡い枠線（`border border-border`）または淡い背景、角丸 12px（`rounded-card`）。
- 状態は「アイコン＋文字」のバッジで表す。色だけに頼らない。
- 色は `globals.css` のトークン（`bg-surface`、`text-text-muted`、`border-border`、`bg-primary` など）だけを使う。
- 本文 16px 以上。アイコンのみのボタンに `aria-label`。タップ領域 44px 以上（`min-h-11 min-w-11`）。
- 文言は日本語。読み込み中・空・エラー・停止中の状態を必ず用意する。
- 写真の読み込み失敗時はカテゴリのアイコンで代替表示。

### テスト
- 単体：`vitest`（`src/**/*.test.ts(x)`）。ロジック（planner、validation、memory repo、API ハンドラ）を優先。
- E2E：`e2e/*.spec.ts`（Playwright、memory モード）。
- 振る舞いを変えたら同じ変更にテストと `docs/` の更新を含める。

### コマンド
```
npm run typecheck   # next typegen && tsc --noEmit
npm run lint
npm run test        # vitest run
npm run build
npm run db:validate # ローカル PostGIS で migration を検証
npm run test:e2e    # 事前に npm run build
```

## 5. 並行作業時の禁止事項

- `npm install` / `package.json` の変更（必要な依存は報告する）。
- `next build` / `next dev` の起動（統合・E2E 担当のみ）。`tsc --noEmit` と `vitest run <自分のテスト>` は可。
- 自分の担当外のファイルの編集。共有ファイルへの変更は報告する。
- `git commit` / `git push`（統合担当のみ）。

## 6. 秘密情報・個人情報

- API キーはサーバー専用の環境変数。`NEXT_PUBLIC_` を付けない。
- 画像はブラウザで再エンコードして EXIF を除去する。ユーザーの現在地は保存しない（スポット座標としてのみ保存）。
- ログにメールアドレス・現在地を出さない。
