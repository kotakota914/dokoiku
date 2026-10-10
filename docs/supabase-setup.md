# Supabase セットアップ手順

`DATA_BACKEND=supabase` で動かすための手順。memory モード（既定）では不要。

関連ファイル

- `supabase/migrations/0001_init.sql`：テーブル、インデックス、トリガー、RLS、RPC 関数
- `supabase/migrations/0002_storage.sql`：Storage バケット `post-images` と読み取り policy
- `supabase/seed.sql`：京都市内 40 スポットと投稿のサンプル
- `scripts/db/validate-migrations.sh`：ローカル PostgreSQL で migration と seed を検証（`npm run db:validate`）
- `src/lib/repo/supabase/`：Supabase 実装の Repository

## 1. プロジェクトを作る

1. https://supabase.com/dashboard で New project。リージョンは Northeast Asia (Tokyo) を推奨。
2. Database password は控えておく（CLI で `db push` するときに使う）。
3. 接続情報を控える（Dashboard の画面構成は時期によって変わる。次のどちらかで見つかる）。
   - **いちばん簡単**：プロジェクトのトップ画面の上部にある **Connect** ボタン → **App Frameworks** → Next.js を選ぶと、`.env` に貼る形で URL とキーがそのまま表示される。
   - **設定画面から**：左下の歯車 **Project Settings** → **Data API** に Project URL（`https://xxxx.supabase.co`）、同じ設定の **API Keys** にキーがある。
   - 対応関係：
     - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
     - 公開用キー（`anon` または新形式の `sb_publishable_...`）→ `NEXT_PUBLIC_SUPABASE_ANON_KEY`
     - サーバー用キー（`service_role` または新形式の `sb_secret_...`）→ `SUPABASE_SERVICE_ROLE_KEY`（サーバー専用。ブラウザへ出さない。GitHub にも載せない）
   - 新形式のキーは「API Keys」ページで作成する。旧形式（anon / service_role）は「Legacy API keys」タブにある。どちらでも動く。

## 2. migration と seed を適用する

### 方法 A：SQL Editor（手軽）

1. Dashboard > SQL Editor を開く。
2. `supabase/migrations/0001_init.sql` の内容を貼り付けて Run。
3. `supabase/migrations/0002_storage.sql` を貼り付けて Run。
4. 開発・デモ用のデータが要るなら `supabase/seed.sql` を貼り付けて Run。
   - seed は `auth.users` にサンプル投稿者（固定 UUID）を 1 行入れる。本番では seed を流さない。
   - 何度流しても同じ結果になる（`on conflict do nothing`）。

### 方法 B：supabase CLI

```bash
npm i -g supabase            # または npx supabase
supabase login
supabase link --project-ref <project-ref>
supabase db push             # supabase/migrations/*.sql を順に適用
# seed（任意）
psql "$DATABASE_URL" -f supabase/seed.sql
```

`DATABASE_URL` は Project Settings > Database > Connection string（URI）の値。

### 適用後の確認

Dashboard > Table Editor に `profiles`, `spots`, `posts`, `post_images`, `likes`, `wishlists`, `wishlist_items`, `plans`, `travel_time_cache`, `api_usage`, `reports` があり、すべて RLS が有効（盾のアイコン）になっていること。
SQL Editor で次を実行して 40 件返れば seed も入っている。

```sql
select count(*) from spots_in_bbox(135.55, 34.85, 135.90, 35.20);
```

PostGIS を Dashboard（Database > Extensions）で先に有効化していた場合は `extensions` スキーマに入る。migration の関数は `search_path = public, extensions` なのでどちらでも動く。

## 3. Google ログインを有効にする

1. Google Cloud Console で OAuth クライアント ID（ウェブ アプリケーション）を作る。
   - 承認済みのリダイレクト URI：`https://<project-ref>.supabase.co/auth/v1/callback`
2. Supabase Dashboard > Authentication > Providers > Google を有効にし、Client ID と Client Secret を入れる。
3. Authentication > URL Configuration
   - Site URL：`<SITE_URL>`（本番は Vercel の URL、ローカルは `http://localhost:3000`）
   - Redirect URLs：`<SITE_URL>/auth/callback` を追加（ローカルと本番の両方）

アプリ側は `signInWithOAuth({ provider: "google", options: { redirectTo: "<SITE_URL>/auth/callback" } })` で開始し、`/auth/callback` でセッションを確定する。

## 4. Storage を確認する

1. Dashboard > Storage にバケット `post-images` があり、Public になっていること（`0002_storage.sql` が作る）。
2. 書き込みの policy は作らない。アップロードはサーバーが発行する署名付き URL（`POST /api/v1/uploads`）で行い、一時パス `posts/tmp/{userId}/` から `posts/{postId}/` への移動と削除は service role が行う。
3. seed の画像（`seed/<ローマ字>/<n>.webp`、`<n>_t.webp`）を置く場合は、このバケットへ同じパスでアップロードする。無くても UI はカテゴリのアイコンで代替表示する。

## 5. 環境変数

`.env.local`（ローカル）に次を設定する。`.env.example` も参照。

```
DATA_BACKEND=supabase
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

`SUPABASE_SERVICE_ROLE_KEY` は api_usage・通報・退会・一時ファイル削除・共有リスト閲覧・統計更新に使う。未設定だとこれらの機能が動かない。

## 6. Vercel の環境変数

Vercel > Project > Settings > Environment Variables に同じ 5 つを設定する（Production / Preview の両方）。

- `NEXT_PUBLIC_SITE_URL` は本番 URL（例 `https://dokoiko.vercel.app`）。
- `SUPABASE_SERVICE_ROLE_KEY` は Sensitive にする。
- 外部サービスを使う場合は `ORS_API_KEY`、`NOMINATIM_USER_AGENT`、通知する場合は `NOTIFY_WEBHOOK_URL` も設定する。

設定後、Supabase の Redirect URLs に Vercel の `https://<app>.vercel.app/auth/callback` を追加する。Preview デプロイでもログインするなら `https://*-<team>.vercel.app/auth/callback` のようにワイルドカードで追加する。

## 7. 無料枠の確認項目（要件定義書 14章）

Supabase Free の目安（2026/10 時点。Dashboard > Settings > Usage で実値を確認する）

| 項目     | 無料枠                       | 対応                                                                                           |
| -------- | ---------------------------- | ---------------------------------------------------------------------------------------------- |
| Database | 500 MB                       | 80%（400 MB）でメンバーに通知（Q4：閲覧は続け、新規投稿のみ停止）                              |
| Storage  | 1 GB                         | 80%（約 820 MB）で新規投稿を停止。写真は本画像（長辺 1600px）＋サムネイル（長辺 400px）の WebP |
| 転送量   | 5 GB/月                      | 画像はサムネイル優先で表示する                                                                 |
| 休止     | 1 週間アクセスなしで一時停止 | 12章の「無料プランの休止防止」（毎日の軽い問い合わせ）                                         |

使用量は `api_usage`（provider = `supabase`、feature = `post_create`、period = `YYYY-MM`）に外部から書き込み、`USAGE_SUSPEND_RATIO`（0.8）を超えたら `GET /api/v1/system/status` が停止中として返す。

Supabase Free には Spend cap など上限を設定する項目が無い。外部サービス側で設定できる上限（F-8-6）は [docs/setup.md](./setup.md) 5 章「サービス側の上限（クォータ）設定」を参照。

## 8. ローカルでの migration 検証

PostgreSQL 16 ＋ PostGIS 3.x があれば、Supabase に接続せずに検証できる。

```bash
npm run db:validate
# 接続先を指定する場合
DATABASE_URL=postgres://postgres:password@localhost:5432/postgres npm run db:validate
# Storage の migration を省略する場合
SKIP_STORAGE=1 npm run db:validate
```

使い捨て DB `dokoiko_validate` を作り直し、`scripts/db/local-stubs.sql`（auth / storage スキーマと役割のスタブ）→ migration → seed → `scripts/db/smoke.sql`（bbox 検索 40 件、近傍検索、統計、RLS）の順に流す。1 つでも失敗すると非 0 で終了する。

## 9. RLS と権限の要点（要件定義書 10.3）

- `spots` / `post_images` / `likes` / `profiles`：読み取りは全員。
- `posts`：`status = 'public'` は全員、hidden は本人と管理者（`is_admin()`）のみ。作成・更新・削除は本人。
- `post_images`：追加・削除は自分の投稿に対してのみ（F-2-12 の写真の追加削除に必要）。
- `wishlists` / `wishlist_items` / `plans`：本人のみ。共有リストは service role が `share_token` で読む。
- `reports` / `api_usage` / `travel_time_cache`：policy なし（service role のみ）。
- スポットの統計（投稿数・代表写真・中央値・時間帯分布・カテゴリ）は `recompute_spot_stats()`、いいね数はトリガーで更新する。クライアントは `spots` を直接更新できない。
- 管理者にするには SQL Editor で `update profiles set is_admin = true where id = '<uuid>'`。
