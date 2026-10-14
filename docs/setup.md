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

ログインは `/login` の「開発用ログイン」から初期データのユーザー（一般ユーザー 2 人、管理者 1 人）を選ぶ。Google ログインは使わない。`MEMORY_PERSIST=off` にするとサーバー再起動ごとに初期データ（金沢市・野々市市 44 スポット。`seed-data/kanazawa/spots.json`）へ戻る。

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
| `SENTRY_DSN`                    | 任意 | 予約のみ。Sentry は未導入で、設定しても何も起きない（5 章「エラー監視」） |

3. Supabase の Redirect URLs に `https://<app>.vercel.app/auth/callback` を追加する。Preview でもログインするならワイルドカード（`https://*-<team>.vercel.app/auth/callback`）を追加する。

Hobby プランの注意

- 非商用利用のみ。Serverless Function の実行時間は既定 10 秒（経路計算は 10 か所で 5 秒以内を目標にしている）。
- `cacheComponents` は使わず全ページ動的描画なので、キャッシュ関連の設定は不要。
- 画像は Supabase Storage の公開 URL を `<img>` で直接表示する（Vercel の Image Optimization を使わない）。

## 4. GitHub Actions（定期処理）

> **既定では定期実行は無効。** secrets を設定したうえで、リポジトリの Settings > Secrets and variables > Actions > **Variables** に `OPS_ENABLED` = `true` を追加すると毎日動き始める。未設定のあいだは各ワークフローがスキップされ、失敗通知は来ない（手動実行 Run workflow は常に可能）。

`.github/workflows/` の 4 つのワークフローは **リポジトリ直下** に置く前提（このアプリをリポジトリのルートにする）。サブディレクトリに置く場合は `cleanup.yml` の `working-directory` を調整する。cron はすべて UTC で書いてある。

| ワークフロー              | 実行          | 内容                                                                                                                                                                       |
| ------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backup-db.yml`           | 毎日 3:00 JST | `pg_dump` → gzip → openssl 暗号化 → Cloudflare R2 へ保存。30 日より古いものを削除（F-9、ADR-0011）                                                                         |
| `backup-photos.yml`       | 毎週月曜 4:00 | Storage の `post-images` を rclone で R2 へ同期                                                                                                                            |
| `cleanup.yml`             | 毎日 4:30 JST | `scripts/ops/cleanup.ts`：24 時間以上前の `posts/tmp/` と 30 日より古い `travel_time_cache` を削除                                                                         |
| `keepalive-and-usage.yml` | 毎日 5:15 JST | `select 1`（休止防止）と DB・Storage の使用量を `api_usage` へ記録。80% で `post_create` を停止・通知。前日に停止していた ORS / Nominatim が日付の切替で再開したことも通知 |

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

| サービス         | 確認する場所                                   | 目安                                 | アプリの動作                                                                                                                                   |
| ---------------- | ---------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase         | Settings > Usage                               | DB 500MB、Storage 1GB、転送量 5GB/月 | 容量 80% で新規投稿のみ停止（閲覧・リスト・経路は継続）。転送量は自動監視しない（下記）。1 週間アクセスなしで休止するため keepalive を毎日実行 |
| OpenRouteService | ダッシュボードの Quota                         | 経路 2,000 回/日、行列 500 回/日     | 80%（1,600 / 400）で経路作成を停止                                                                                                             |
| Nominatim        | （公開サーバーのため計測は自前の `api_usage`） | 1 秒 1 回、自動補完禁止              | サーバー側で 1 秒 1 回に直列化、日 500 回で自主停止                                                                                            |
| Vercel Hobby     | Usage                                          | 非商用のみ、Function 10 秒           | —                                                                                                                                              |
| GitHub Actions   | Settings > Billing                             | 非公開リポジトリ 月 2,000 分         | 定期処理 4 本で月 100 分程度                                                                                                                   |
| Cloudflare R2    | R2 > Overview                                  | 10GB                                 | DB ダンプ 30 日分 + 写真                                                                                                                       |
| Sentry Developer | （未導入）                                     | 月 5,000 件程度                      | 未導入。エラーは Vercel のログで確認する（下記「エラー監視」）                                                                                 |

停止中の機能は `GET /api/v1/system/status` で確認できる。画面は起動時に取得して該当ボタンを無効化し、理由を表示する（F-8-5）。

### サービス側の上限（クォータ）設定（F-8-6）

アプリ側の自主停止（`api_usage` の 80%）に加えて、外部サービスの管理画面で 1 日の上限を設定できるものは設定しておく（二重の守り）。設定値はアプリ側の停止判定（`src/lib/domain/constants.ts` の `USAGE_LIMITS`）より少し大きくし、通常はアプリ側が先に止まるようにする。設定項目が無いサービスは「設定不可」とし、アプリ側の自主停止だけで守る。初回セットアップ時と、キーを作り直したときに確認する。

| サービス         | 設定する場所                                    | 設定値・手順                                                                                                                                                                                                                                    |
| ---------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenRouteService | ダッシュボード > Tokens（トークンごとの Quota） | 無料プランの既定は Directions 2,000 回/日、Matrix 500 回/日。トークンの上限を下げられる画面があれば Directions 1,700 / Matrix 450（アプリの停止値 1,600 / 400 より少し上）に設定する。下げる項目が無ければ設定不可（既定の 2,000 / 500 のまま） |
| Nominatim        | （公開サーバー。アカウント・管理画面なし）      | 設定不可。アプリ側で 1 秒 1 回の直列化と日 500 回の自主停止のみ。`NOMINATIM_USER_AGENT` に連絡先を入れておく（利用規約）                                                                                                                        |
| Google Cloud     | APIs & Services > Quotas（OAuth クライアント）  | 設定不要。使うのはログイン用の OAuth クライアントだけで、課金対象の API（Maps 等）は有効にしない。経路の Google マップリンクは URL を開くだけで API を呼ばない。誤って Maps API を有効にしないことを確認する                                    |
| Supabase Free    | Organization > Settings > Billing               | Free プランには Spend cap の設定項目が無い（上限到達で機能停止）。容量はアプリ側の 80% 停止（`keepalive-and-usage.yml`）と使用量メール通知（上記「転送量」）で守る                                                                              |
| Vercel Hobby     | Settings > Billing > Spend Management           | Hobby には設定項目が無い（Pro のみ）。Hobby の上限は固定（超過で停止、課金なし）のため設定不要                                                                                                                                                  |
| GitHub Actions   | Settings > Billing and plans > Spending limits  | Actions の spending limit を `$0`（既定）のままにする。月 2,000 分を超えたら定期処理が止まるだけで課金されない                                                                                                                                  |
| Cloudflare R2    | R2 > Overview                                   | 設定項目なし（無料枠 10GB を超えると課金対象になるため、`backup-db.yml` の 30 日削除とバケットサイズの月 1 回確認で守る）                                                                                                                       |

### 転送量（Egress）の確認（手動）

Supabase の転送量（無料枠 5GB/月）は SQL から取得できないため、`keepalive-and-usage.yml` は記録も通知もしない（監視対象は DB と Storage の容量だけ。ADR-0015）。次の 2 つで代替する。

1. Supabase Dashboard > Settings > Usage の Egress を月に 1 回（目安：月半ばと月末）確認する。80%（4GB）を超えていたら Discord でメンバーに共有する。停止は不要（閲覧を止めない。Q4）。
2. Supabase の Organization > Settings > Billing で使用量のメール通知（Spend / usage alerts）を有効にし、Supabase からのメールが届く Google アカウントをチーム全員が確認できる状態にしておく。

転送量が繰り返し上限に近づく場合は、写真のサムネイル（長辺 400px）を一覧で優先して使うなど、アプリ側の削減策を別途検討する。

### エラー監視

Sentry は導入していない（`@sentry/nextjs` を追加していない。`SENTRY_DSN` は予約のみで未使用）。要件定義書 13 章の「エラー率 5% 超で通知」は、次の手動確認で代替する。

- Vercel Dashboard > Project > Logs（Runtime Logs）で `status >= 500` を絞り込み、デモ前と週に 1 回確認する。Route Handler の例外は `src/lib/api/handler.ts` の `route()` が 500 `INTERNAL_ERROR` に変換してログに出す。
- 画面側の例外は `src/app/error.tsx` が受け、ブラウザのコンソールに出る。
- 定期処理（GitHub Actions）の失敗は各ワークフローの `Notify failure` ステップが Discord に通知する。

導入する場合は統合担当が `@sentry/nextjs` を追加し、`instrumentation.ts` で `SENTRY_DSN` を読んで初期化する（`src/lib/config.ts` の `serverConfig.sentryDsn` をそのまま使う）。

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
