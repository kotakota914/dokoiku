# 設計判断の記録（要件定義書 15章への回答と追加 ADR）

元資料の ADR.md（ADR-0001〜0012）はこのリポジトリに含まれていないため、本書では ADR-0013 以降を仮番号として記録する。チームの ADR.md へ転記する際に番号を合わせること。

## 1. 15章「検討事項」への回答（すべて推奨案を採用）

| Q | 回答 | 実装上の扱い |
| --- | --- | --- |
| Q1 | **B**（MVP＋行きたい場所リスト＋経路作成） | デモ導線「写真で探す → リストに入れる → 経路ができる」を最優先。検索・いいね・共有・通報・管理 API も実装済みだが磨き込みは後回し |
| Q2 | 3.1 の推奨スタックをそのまま採用 | ADR-0013 |
| Q3 | ADR-0009 / 0010 / 0011 を承認 | 11章のロジックを `src/lib/planner`、バックアップを `.github/workflows` に実装 |
| Q4 | **B**（容量 80% で新規投稿だけ停止） | ADR-0015。`api_usage` に `supabase/post_create` を記録し、`POST /uploads` と `POST /posts` を 503 にする |
| Q5 | **A**（徒歩・車のみ＋Google マップリンク） | 区間ごとに `googleMapsDirectionsUrl(..., "transit")` |
| Q6 | **A**（自前DB優先＋Nominatim は検索ボタン押下時のみ） | 1秒1回の直列キュー、日 500 回で自主停止 |
| Q7 | **A**（GPS 誤差 100m 未満なら新規スポット作成可） | 半径 50m 内の類似名は 409 `CONFLICT` と候補を返す |
| Q8 | **A**（Google ログインのみ） | memory モードでは開発用ログイン（`/api/dev/login`）を使う |
| Q9 | 5 カテゴリ、標準滞在時間は現案 | `CATEGORY_DEFAULT_STAY_MIN` |
| Q10 | **A → B**（MVP では営業時間を扱わない） | `spots.opening_hours` 列は作成済み。値があれば経路計算で判定する |
| Q11 | 通常 1〜4 / 人気 5〜19 / 大人気 20 以上 | `POPULARITY_THRESHOLDS` |
| Q12 | ライトのみ、日本語のみ、昼食は `coffee`、メインカラーは仮で空色 | `globals.css` の `--color-primary` を変えれば全体に反映 |
| Q13 | 通報 3 件で自動非表示、管理画面は作らない | 管理 API（`/admin/*`）は `is_admin` のユーザーのみ |
| Q14 | Discord Webhook | `NOTIFY_WEBHOOK_URL` 未設定時はサーバーログのみ |
| Q15 | 非公開リポジトリ | — |
| Q16 | 京都市内 40 スポット前後 | memory の seed と `supabase/seed.sql`。写真は自前撮影に差し替える前提のプレースホルダー |
| Q17 | **B 相当** | ADR-0017 |

## 2. 追加 ADR

### ADR-0013 技術スタックの確定
- Next.js 16（App Router、Turbopack）、TypeScript、Tailwind CSS v4、lucide-react、MapLibre GL JS＋OpenFreeMap、Supercluster、Supabase（Auth / PostgreSQL＋PostGIS / Storage）、OpenRouteService、Nominatim、Vercel、Sentry（任意）、GitHub Actions。
- 理由：要件定義書 3.1 のとおり。すべて無料枠で運用でき、画面と API を 1 リポジトリで作れる。

### ADR-0014 データ保存先の切り替え（memory / supabase）
- `DATA_BACKEND` で Memory Repository と Supabase Repository を切り替える。API・画面は `Repository` インターフェース（`src/lib/repo/types.ts`）だけに依存する。
- 理由：Supabase の設定前でも全機能を動かして開発・デモ・テストができる。既存チームリポジトリの「Memory Repository で振る舞いを完成させてから Postgres 実装へ」という進め方と同じ。
- 影響：memory モードは単一サーバー専用（Vercel の複数インスタンスでは使わない）。本番は supabase。

### ADR-0015 Supabase 無料枠の扱い（Q4）
- 容量（DB 500MB、Storage 1GB）の 80% で `post_create` だけ停止。閲覧・リスト・経路作成は続ける。
- 使用量は GitHub Actions の日次ジョブが `pg_database_size` と `storage.objects` の合計サイズを `api_usage` に書き込む（アプリは Management API を呼ばない）。

### ADR-0016 cacheComponents（PPR）を使わない
- `next.config.ts` で `cacheComponents: false`。
- 理由：ほぼ全ページが位置情報・ログイン状態に依存する動的画面で、静的シェルの恩恵が小さい。Suspense 境界の必須化による実装コストを避ける。

### ADR-0017 スポット詳細の表示方法（Q17）
- URL は `/spots/[spotId]` の通常ページ。スマホでは全画面シート風のレイアウト（上部に「地図に戻る」）で表示し、地図の位置は URL ハッシュ（`#zoom/lat/lng`）で保持するので、戻ったときに同じ位置に復帰する。
- 理由：Next.js の intercepting routes よりも単純で壊れにくく、直接開いたときもページとして表示できる。

### ADR-0018 外部 API が未設定のときの代替動作
- OpenRouteService 未設定：移動時間は直線距離 × 迂回係数 1.3 ÷ 速度（徒歩 4.5km/h、車 30km/h）で概算し、経路線は直線。画面に「概算」と明示する。
- Nominatim 無効：自前DBの検索と GPS のみ。画面に「外部の場所検索は利用できません」と表示する。
- 理由：ハッカソンのデモや審査環境で API キーがなくても導線が途切れないようにする。

### ADR-0019 画像の変換と保存
- ブラウザで WebP（長辺 1600px / 400px）に再エンコードして EXIF を除去。WebP エンコードに対応しないブラウザでは JPEG にフォールバックし、`contentType` を `image/jpeg` で送る。
- HEIC は `heic2any` でブラウザ側で JPEG に変換してから処理する。
- アップロードは署名付き URL への `PUT`。memory モードでは `/api/dev/uploads` が同じ契約で受ける。

## 3. 既知の制約（実装時点）
- レート制限はサーバーインスタンス内のメモリで行う（複数インスタンスでは厳密でない）。投稿数は DB でも確認する。
- PC の 2 カラム（左パネル＋右地図）はトップ画面のみ。詳細・リストは通常ページ。
- Supabase の初期データの写真は Storage に手動で配置する必要がある。
