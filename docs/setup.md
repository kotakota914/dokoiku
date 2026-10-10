# セットアップ手順

「旅行どこいこう」をローカルで動かす手順、Supabase モードへの切り替え、Vercel へのデプロイ、GitHub Actions の設定をまとめる。

## 1. ローカル起動（memory モード）

Supabase や外部 API のキーが無くても全機能を試せる。データはサーバー内メモリと `.data/memory.json` に保存され、画像は `.data/uploads/` に置かれる（どちらも Git 管理外）。

前提：Node.js 20.9 以上（22 推奨）、npm。

```bash
cp .env.example .env        # DATA_BACKEND=memory のまま
npm install
npm run dev                 # http://localhost:3000
```

ログインは `/login` の「開発用ログイン」から初期データのユーザー（一般ユーザー 2 人、管理者 1 人）を選ぶ。Google ログインは使わない。`MEMORY_PERSIST=off` にするとサーバー再起動ごとに初期データ（京都市内 40 スポット前後）へ戻る。

外部 API（OpenRouteService、Nominatim）が未設定のときは代替動作になる（移動時間は直線距離からの概算、場所検索は自前 DB のみ）。画面には「概算」「外部検索は利用できません」と表示される。

## 2. Supabase モード

本番と同じ構成（Supabase Auth による Google ログイン、PostgreSQL + PostGIS、Storage）。プロジェクト作成、migration、Google プロバイダ、Storage の設定は [docs/supabase-setup.md](./supabase-setup.md) を参照。

`.env.local` に次を設定して `npm run dev`。

```
DATA_BACKEND=supabase
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

ログインの流れ：`/login` →「Googleでログイン」→ Google → Supabase → `/auth/callback?code=...` でセッション確定 → 初回はプロフィール設定 `/welcome` → 元のページ。Supabase の Authentication > URL Configuration > Redirect URLs に `http://localhost:3000/auth/callback` を登録しておく。

## 3. Vercel デプロイ

1. GitHub リポジトリを Vercel にインポートする（Framework: Next.js、Root Directory はこのアプリのディレクトリ）。
2. Settings > Environment Variables に次を設定する（Production と Preview）。

| 変数                            | 必須 | 内容                                                                      |
| ------------------------------- | ---- | ------------------------------------------------------------------------- |
| `DATA_BACKEND`                  | 必須 | `supabase`（Vercel は複数インスタンスで動くため memory モードは使えない） |
| `NEXT_PUBLIC_SUPABASE_URL`      | 必須 | Supabase の Project URL                                                   |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 必須 | anon public キー                                                          |
| `SUPABASE_SERVICE_ROLE_KEY`     | 必須 | service_role キー。Sensitive にする                                       |
| `NEXT_PUBLIC_SITE_URL`          | 必須 | 本番 URL（例 `https://dokoiko.vercel.app`）                               |
| `ORS_API_KEY`                   | 任意 | OpenRouteService のキー。無ければ直線距離で概算                           |
| `NOMINATIM_USER_AGENT`          | 任意 | Nominatim の利用規約で求められる連絡先入り UA                             |
| `NOMINATIM_ENABLED`             | 任意 | `false` で外部検索を無効化                                                |
| `NOTIFY_WEBHOOK_URL`            | 任意 | Discord Webhook（無料枠停止・再開の通知）                                 |
| `SENTRY_DSN`                    | 任意 | Sentry                                                                    |

3. Supabase の Redirect URLs に `https://<app>.vercel.app/auth/callback` を追加する。Preview でもログインするならワイルドカード（`https://*-<team>.vercel.app/auth/callback`）を追加する。

Hobby プランの注意

- 非商用利用のみ。Serverless Function の実行時間は既定 10 秒（経路計算は 10 か所で 5 秒以内を目標にしている）。
- `cacheComponents` は使わず全ページ動的描画なので、キャッシュ関連の設定は不要。
- 画像は Supabase Storage の公開 URL を `<img>` で直接表示する（Vercel の Image Optimization を使わない）。

## 4. GitHub Actions（定期処理）

`.github/workflows/` の 4 つのワークフローは **リポジトリ直下** に置く前提（このアプリをリポジトリのルートにする）。サブディレクトリに置く場合は `cleanup.yml` の `working-directory` を調整する。cron はすべて UTC で書いてある。

| ワークフロー              | 実行          | 内容                                                                                                  |
| ------------------------- | ------------- | ----------------------------------------------------------------------------------------------------- |
| `backup-db.yml`           | 毎日 3:00 JST | `pg_dump` → gzip → openssl 暗号化 → Cloudflare R2 へ保存。30 日より古いものを削除（F-9、ADR-0011）    |
| `backup-photos.yml`       | 毎週月曜 4:00 | Storage の `post-images` を rclone で R2 へ同期                                                       |
| `cleanup.yml`             | 毎日 4:30 JST | `scripts/ops/cleanup.ts`：24 時間以上前の `posts/tmp/` と 30 日より古い `travel_time_cache` を削除    |
| `keepalive-and-usage.yml` | 毎日 5:15 JST | `select 1`（休止防止）と DB・Storage の使用量を `api_usage` へ記録。80% で `post_create` を停止・通知 |

Settings > Secrets and variables > Actions に設定する secrets

| secret                                                        | 使うワークフロー               | 取得先                                                                                  |
| ------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------- |
| `SUPABASE_DB_URL`                                             | backup-db, keepalive-and-usage | Supabase > Project Settings > Database > Connection string（URI）                       |
| `SUPABASE_URL`                                                | cleanup                        | Project URL（`NEXT_PUBLIC_SUPABASE_URL` と同じ値）                                      |
| `SUPABASE_SERVICE_ROLE_KEY`                                   | cleanup                        | Project Settings > API > service_role                                                   |
| `SUPABASE_S3_ENDPOINT` / `SUPABASE_S3_REGION`                 | backup-photos                  | Project Settings > Storage > S3 Connection（`https://<ref>.supabase.co/storage/v1/s3`） |
| `SUPABASE_S3_ACCESS_KEY_ID` / `SUPABASE_S3_SECRET_ACCESS_KEY` | backup-photos                  | 同画面の S3 Access Keys                                                                 |
| `BACKUP_PASSPHRASE`                                           | backup-db                      | 自分で生成した長いランダム文字列（復元に必要。別途保管する）                            |
| `R2_ACCOUNT_ID`                                               | backup-db, backup-photos       | Cloudflare ダッシュボードのアカウント ID                                                |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`                   | backup-db, backup-photos       | R2 > Manage R2 API Tokens（Object Read & Write）                                        |
| `R2_BUCKET`                                                   | backup-db, backup-photos       | バックアップ用バケット名（例 `dokoiko-backup`）                                         |
| `NOTIFY_WEBHOOK_URL`                                          | すべて（任意）                 | Discord > サーバー設定 > 連携サービス > ウェブフック                                    |

復元テスト（毎月、手動）：`backup-db.yml` 冒頭のコメントにある手順で R2 からダンプを取得し、ローカル PostgreSQL に流して確認する。

## 5. 無料枠の確認項目（要件定義書 14章）

数値は 2026/10 時点の想定。各ダッシュボードで実値を確認する。

| サービス         | 確認する場所                                   | 目安                                 | アプリの動作                                                                                                   |
| ---------------- | ---------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Supabase         | Settings > Usage                               | DB 500MB、Storage 1GB、転送量 5GB/月 | 容量 80% で新規投稿のみ停止（閲覧・リスト・経路は継続）。1 週間アクセスなしで休止するため keepalive を毎日実行 |
| OpenRouteService | ダッシュボードの Quota                         | 経路 2,000 回/日、行列 500 回/日     | 80%（1,600 / 400）で経路作成を停止                                                                             |
| Nominatim        | （公開サーバーのため計測は自前の `api_usage`） | 1 秒 1 回、自動補完禁止              | サーバー側で 1 秒 1 回に直列化、日 500 回で自主停止                                                            |
| Vercel Hobby     | Usage                                          | 非商用のみ、Function 10 秒           | —                                                                                                              |
| GitHub Actions   | Settings > Billing                             | 非公開リポジトリ 月 2,000 分         | 定期処理 4 本で月 100 分程度                                                                                   |
| Cloudflare R2    | R2 > Overview                                  | 10GB                                 | DB ダンプ 30 日分 + 写真                                                                                       |
| Sentry Developer | Stats                                          | 月 5,000 件程度                      | 任意                                                                                                           |

停止中の機能は `GET /api/v1/system/status` で確認できる。画面は起動時に取得して該当ボタンを無効化し、理由を表示する（F-8-5）。

## 6. 検証コマンド

```bash
npm run typecheck   # next typegen && tsc --noEmit
npm run lint
npm run test        # vitest run
npm run build
npm run db:validate # ローカル PostGIS で migration を検証
npm run test:e2e    # 事前に npm run build
```

E2E（`e2e/*.spec.ts`）は memory モードの本番ビルドを `127.0.0.1:3100` で起動して実行する（`playwright.config.ts`）。地図のスタイル（OpenFreeMap）はテスト側で最小スタイルに差し替えるため、外部ネットワークが無くても写真ピンなどの DOM マーカーまで確認できる。共通の補助（開発用ログイン、最小 PNG の生成、コンソールエラーの検出）は `e2e/helpers.ts` にある。
