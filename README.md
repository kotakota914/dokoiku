# 旅行どこいこう（dokoiko）

地図上に、ユーザーが投稿した現地の写真付きピンを表示し、人気スポットや隠れた名所を視覚的に見つけられる旅行計画アプリ。行きたい場所を選ぶと、移動時間・滞在時間・おすすめの時間帯を考慮した無理のない回り方を自動で作成し、旅行の計画疲れを減らす。対象は友達と国内旅行を計画する大学生で、スマートフォンのブラウザでの利用を主とする。

## 主な機能

| 段階         | 機能                                                                                                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MVP          | F-1 マップ表示（ヒートマップ / 写真の束 / 写真ピン）、F-2 写真付きスポット投稿、F-3 スポット詳細、F-6 認証・マイページ、F-8 無料枠管理（80% で自動停止）、F-9 DB バックアップ |
| β版          | F-3 検索・いいね、F-4 行きたい場所リスト、F-5 おすすめ経路の自動作成                                                                                                          |
| 正式リリース | F-4 リスト共有、F-7 通報・管理 API、UI・性能改善                                                                                                                              |

JPHACKS のデモ対象は「MVP ＋ 行きたい場所リスト ＋ 経路作成」（`docs/decisions.md` Q1）。

## デモの導線

1. マップで写真ピンを眺め、気になるスポットの詳細を開いて「リストに追加」する。
2. 行きたい場所リストで必ず行きたい場所を選び、「経路を作る」で出発地・日付・時間・移動手段を入力する。
3. 滞在時間とおすすめの時間帯を考慮したタイムラインと地図が表示されるので、順番を並べ替えて保存する。

## スクリーン一覧

| ID   | 画面                            | URL                                              | ログイン     |
| ---- | ------------------------------- | ------------------------------------------------ | ------------ |
| S-01 | マップ（トップ）                | `/`                                              | 不要         |
| S-02 | スポット詳細                    | `/spots/[spotId]`                                | 不要         |
| S-03 | 検索結果                        | `/search`                                        | 不要         |
| S-04 | 投稿作成（4 ステップ）          | `/posts/new`                                     | 必要         |
| S-05 | 投稿編集                        | `/posts/[postId]/edit`                           | 必要（本人） |
| S-06 | リスト一覧                      | `/lists`                                         | 必要         |
| S-07 | リスト詳細                      | `/lists/[listId]`                                | 必要（本人） |
| S-08 | 経路作成（条件入力）            | `/lists/[listId]/plan`                           | 必要（本人） |
| S-09 | 経路プラン                      | `/plans/[planId]`、`/lists/[listId]/plan/result` | 必要（本人） |
| S-10 | 共有リスト                      | `/shared/[token]`                                | 不要         |
| S-11 | ログイン                        | `/login`                                         | —            |
| S-12 | 初回プロフィール設定            | `/welcome`                                       | 必要         |
| S-13 | マイページ                      | `/me`                                            | 必要         |
| S-14 | 利用規約 / プライバシーポリシー | `/terms`、`/privacy`                             | 不要         |

## 技術スタック

- Next.js 16（App Router、Turbopack）、TypeScript、Tailwind CSS v4、lucide-react
- 地図：MapLibre GL JS ＋ OpenFreeMap、Supercluster
- バックエンド：Supabase（Auth / PostgreSQL ＋ PostGIS / Storage）。開発・デモ・テストは Supabase 不要の memory モード（`DATA_BACKEND=memory`）
- 外部 API：OpenRouteService（移動時間・経路形状）、Nominatim（場所検索）。未設定なら代替動作
- ホスティング：Vercel。定期処理（バックアップ・一時ファイル削除・休止防止）：GitHub Actions。バックアップ保存先：Cloudflare R2
- テスト：Vitest、Playwright

## ディレクトリ構成

```
src/app/                 画面と Route Handler（/api/v1/**、/auth/**、開発用 /api/dev/**）
src/components/ui/       UI 部品（Button, Card, Badge, Sheet, Toast, Input, Dialog, EmptyState, ErrorMessage, Spinner, Icon）
src/components/<feature>/ 機能ごとの部品（map, post, spot, list, plan, auth, layout, system）
src/lib/domain/          定数と型（契約）
src/lib/validation/      zod スキーマ（クライアント・サーバー共用）
src/lib/repo/            Repository インターフェースと memory / supabase 実装
src/lib/auth/            getCurrentUser / requireUser / requireAdmin、戻り先の安全判定
src/lib/api/             route() ラッパー、ApiError、parseBody/parseQuery、ブラウザ用 api クライアント
src/lib/external/        OpenRouteService、Nominatim、無料枠管理、通知
src/lib/planner/         経路作成ロジック（純粋関数）
supabase/migrations/     SQL（テーブル、PostGIS、RLS、関数）、supabase/seed.sql
scripts/                 検証・運用スクリプト（db/validate-migrations.sh、ops/cleanup.ts）
.github/workflows/       定期処理（backup-db, backup-photos, cleanup, keepalive-and-usage）
e2e/                     Playwright
docs/                    要件定義書、decisions.md、setup.md、supabase-setup.md
```

## 起動方法

```bash
cp .env.example .env
npm install
npm run dev          # http://localhost:3000（memory モード。/login の開発用ログインでログイン）
```

Supabase モード、Vercel デプロイ、GitHub Actions の secrets は [docs/setup.md](./docs/setup.md) を参照。

## テスト・検証

```bash
npm run typecheck    # next typegen && tsc --noEmit
npm run lint
npm run test         # vitest run（ロジック、validation、memory repo、API ハンドラ）
npm run build
npm run db:validate  # ローカル PostgreSQL + PostGIS で migration と seed を検証
npm run test:e2e     # Playwright（memory モード。事前に npm run build）
npm run check        # typecheck + lint + test
```

## ドキュメント

- [要件定義書](./docs/要件定義書.md)：機能要件、画面、API、データ設計、経路作成ロジック
- [decisions.md](./docs/decisions.md)：15章の検討事項への回答と追加 ADR
- [setup.md](./docs/setup.md)：ローカル起動、Supabase モード、Vercel、GitHub Actions、無料枠の確認項目
- [supabase-setup.md](./docs/supabase-setup.md)：Supabase プロジェクトの作成、migration、Google ログイン、Storage
- [implementation-report.md](./docs/implementation-report.md)：初回実装の報告（検証結果、実装範囲、未確認事項、引き継ぎ）
- [AGENTS.md](./AGENTS.md)：開発規則（UI 規約、契約ファイル、並行作業のルール）
