# 設計判断の記録（要件定義書 15章への回答と追加 ADR）

元資料の ADR.md（ADR-0001〜0012）はこのリポジトリに含まれていないため、本書では ADR-0013 以降を仮番号として記録する。チームの ADR.md へ転記する際に番号を合わせること。

## 1. 15章「検討事項」への回答（すべて推奨案を採用）

| Q   | 回答                                                            | 実装上の扱い                                                                                                                      |
| --- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | **B**（MVP＋行きたい場所リスト＋経路作成）                      | デモ導線「写真で探す → リストに入れる → 経路ができる」を最優先。検索・いいね・共有・通報・管理 API も実装済みだが磨き込みは後回し |
| Q2  | 3.1 の推奨スタックをそのまま採用                                | ADR-0013                                                                                                                          |
| Q3  | ADR-0009 / 0010 / 0011 を承認                                   | 11章のロジックを `src/lib/planner`、バックアップを `.github/workflows` に実装                                                     |
| Q4  | **B**（容量 80% で新規投稿だけ停止）                            | ADR-0015。`api_usage` に `supabase/post_create` を記録し、`POST /uploads` と `POST /posts` を 503 にする                          |
| Q5  | **A**（徒歩・車のみ＋Google マップリンク）                      | 区間ごとに `googleMapsDirectionsUrl(..., "transit")`                                                                              |
| Q6  | **A**（自前DB優先＋Nominatim は検索ボタン押下時のみ）           | 1秒1回の直列キュー、日 500 回で自主停止                                                                                           |
| Q7  | **A**（GPS 誤差 100m 未満なら新規スポット作成可）               | 半径 50m 内の類似名は 409 `CONFLICT` と候補を返す                                                                                 |
| Q8  | **A**（Google ログインのみ）                                    | memory モードでは開発用ログイン（`/api/dev/login`）を使う                                                                         |
| Q9  | 5 カテゴリ、標準滞在時間は現案                                  | `CATEGORY_DEFAULT_STAY_MIN`                                                                                                       |
| Q10 | **A → B**（MVP では営業時間を扱わない）                         | `spots.opening_hours` 列は作成済み。値があれば経路計算で判定する                                                                  |
| Q11 | 通常 1〜4 / 人気 5〜19 / 大人気 20 以上                         | `POPULARITY_THRESHOLDS`                                                                                                           |
| Q12 | ライトのみ、日本語のみ、昼食は `coffee`、メインカラーは仮で空色 | `globals.css` の `--color-primary` を変えれば全体に反映                                                                           |
| Q13 | 通報 3 件で自動非表示、管理画面は作らない                       | 管理 API（`/admin/*`）は `is_admin` のユーザーのみ                                                                                |
| Q14 | Discord Webhook                                                 | `NOTIFY_WEBHOOK_URL` 未設定時はサーバーログのみ                                                                                   |
| Q15 | 非公開リポジトリ                                                | —                                                                                                                                 |
| Q16 | 金沢市・野々市市 44 スポット（金沢工業大学の学内 8 件を含む）  | 元データは `seed-data/kanazawa/spots.json`。memory の seed と `supabase/seed.sql`（生成スクリプト）が共用。写真は `photos.json` があれば実写真、無ければプレースホルダー |
| Q17 | **B 相当**                                                      | ADR-0017                                                                                                                          |

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

## 4. レビュー後の判断（UI 担当）

要件定義書との突き合わせレビュー（フェーズ 4）で挙がった UI の指摘に対する判断。要件定義書 8 章の表を直す際はここを転記する。

- **8.1 アイコン対応表の追加**（1 アイコン 1 意味を保つため）：人気 → `trending-up`（`flame` は大人気のみ）、プラン保存 → `save`（`bookmark` はリストのみ）、非表示の投稿 → `eye-off`（`circle-pause` は機能の停止中のみ）、次へ・進む・外部リンクの矢印 → `chevron-right`。実体は `src/components/ui/icons.tsx` の `ICONS`。
- **8.3 文字サイズ 16px の例外**：地図マーカー上の束の件数バッジ（`markers.ts`、13px）と時間帯ヒストグラムの目盛（`HourHistogram`、14px）は補助的な数値で、同じ値を `aria-label`・シート・バッジで 16px 以上の文字として出しているため例外とする。下部ナビの文字は 14px（`text-sm`）。それ以外の内容テキスト（住所・投稿数・日時・見出しラベル・バッジ）は 16px に統一した。
- **8.1 ボタン内アイコン 20px**：戻る（`PageHeader`）、写真送り（`PhotoGallery`）、必ず行きたい（`ListItemRow`）を 20px にした。24px は下部ナビと空状態の装飾のみ。
- **13 章 コントラスト比**：`--color-primary` を `#1769b8`（白文字 5.6）、`--color-primary-strong` を `#145a99`、`--color-text-muted` を `#5f6670`、`--color-warning` を `#a35400`、`--color-success` を `#237a35` に変更。いずれも各 soft 背景・`surface-muted`・`background` 上で 4.5 以上。placeholder は `text-text-muted`（`text-text-faint` は文字には使わない）。
- **F-1-3 ズーム境界**：`mapModeForZoom` は GET /spots に送る整数ズーム（四捨五入）と同じ丸めで判定する（契約変更：`src/lib/domain/constants.ts`。8/9/13/14 の整数での結果は変わらない）。
- **ADR-0017 補足（詳細から地図へ戻る）**：スポット詳細の「戻る」は履歴があれば `router.back()`（直前の URL ハッシュ＝地図の位置に復帰）、履歴が無ければ `/` へ（`PageHeader` の `backFallbackHref`）。検索・リストから開いた場合はそれぞれの画面に戻る。
- **S-02 → S-07（リストに追加）**：追加後に自動遷移はせず、成功トーストに「リストを見る」の導線を置く（地図やスポット詳細の閲覧を中断しないため）。`Toast` の `action` で実装。
- **S-09 → S-07（プラン保存後）**：保存後は保存済みプラン画面（`/plans/[planId]`）に留まり、「戻る」でリスト詳細へ戻す。保存した内容をその場で確認でき、リスト詳細の「保存済みプラン」からも開ける。7 章の遷移図とは異なるため記録する。
- **F-5-6 終了時刻の超過**：再計算（POST /plans/recompute）はサーバーが items をそのまま返すため、画面側で `endAt > params.endTime` を判定し、`circle-alert` の警告を出して保存を無効にする（契約は変えない）。営業時間外到着の警告は recompute レスポンスに情報が無いため未対応（サーバー担当と契約追加を要相談）。
- **F-5 例外の文言**：経路なしは「この区間の経路が見つかりませんでした」に揃えた。停止中の定型文は共通部品 `SuspendedNotice` の「現在、{機能}は利用できません」のままとする（要件定義書 F-3 は「外部の場所検索は利用できません」、F-5 は「経路作成を利用できません」と助詞が異なるため、共通文言として「は」に統一。`PlanForm` の送信時エラーは要件どおり）。
- **F-2-12 写真の追加・削除**：API レスポンスの `fullPath` / `thumbPath`（memory・supabase とも返す）を「残す写真」として保持し、1 枚ずつ削除・空きがあれば追加できるようにした。投稿停止中（Q4）は写真の追加（アップロード）だけ止め、写真を追加しない編集と削除はできる。
- **一時アップロードの期限切れ**：POST /posts・PATCH /posts の 400 `VALIDATION_ERROR` で `details` に `field: "images"` があれば、保持している tmp パスを捨てて再試行（再アップロード）できるようにした。

## 4. レビュー後の判断（データ担当）

要件定義書との突き合わせレビュー（フェーズ 4）で挙がった Repository・SQL・無料枠管理の指摘に対する判断。memory と supabase の振る舞いを揃えることを優先した。

- **F-7-2 通報数は未処理（open）だけを数える（F3-02）**：supabase の `reports.create` が返す `count` は memory と同じく `status = 'open'` の件数にした。管理者が再表示（`PATCH /admin/posts`）して通報を解決済みにしたあとは、新たに 3 件集まるまで非表示にしない。`ReportsRepo.create` の JSDoc に明記（契約変更は JSDoc のみ）。
- **10.4 Storage の上限（api-02）**：バケット `post-images` に `file_size_limit = 2MB`、`allowed_mime_types = image/webp, image/jpeg` を設定した（署名付き URL への PUT にも効く）。加えて `finalizePostImages`（supabase）が `info()` で実サイズ・形式を確認し、超過・不正な形式は 413 `PAYLOAD_TOO_LARGE`（`details[].field: "images"`）。既存プロジェクトには `0002_storage.sql` の再適用（`on conflict do update`）が必要。
- **13 章 現在地を保存しない（api-04）**：`POST /plans` は出発地・到着地の座標を小数 3 桁（約 100m）に丸めてから保存する（`coarsenSavedPlan`）。出発地が「現在地」かどうかはサーバーで判別できないため、検索で選んだ場所も同じ精度にする（保存プランの表示・Google マップのリンクには十分）。経路形状の先頭と、到着地があれば末尾の点も同じ精度に丸める。計算結果（時刻・移動時間）は丸める前の座標で求めたものをそのまま保存する。`travel_time_cache` のキー（小数 5 桁）は 10.2 の「丸めた座標」として現状維持。プライバシーポリシー（`/privacy`）に明記した。
- **F-3-6 検索の一致規則（F3-07）**：`spots_search` を memory 実装と同じ部分一致に揃えた。都道府県・市区町村は `ilike '%…%'`（`city` は住所の部分一致も可）、キーワードは名前・住所・都道府県・市区町村のいずれかに部分一致。`%` `_` `\` はエスケープする。memory の NFKC 正規化（全角・半角）までは SQL では行わない（既知の差）。
- **9.1 他人のリスト・プランは 403（F4-2）**：supabase の `wishlists.getById` / `plans.getById` は service role で読む。RLS で他人の行が null になると 404 になり、memory と API 契約（403 `FORBIDDEN`）がずれるため。本人確認は service（`getOwnedWishlist` / `getOwnedPlan`）が行い、更新・削除は引き続き Cookie セッション（RLS）で実行する。
- **S-06 リスト一覧の並び（F4-3）**：supabase の `wishlists.listByUser` を memory と同じ新しい順（`created_at desc, id desc`）にした。作成直後に先頭へ挿入する画面と再読み込み後の並びが一致する。
- **10.3 likes の行は本人と管理者だけ（api-05）**：`likes_select_all`（全員）を `likes_select_own`（`user_id = auth.uid() or is_admin()`）に変更。件数は `posts.like_count` / `spots.like_count`（トリガー）で全員に公開し、`likedByMe` は本人行だけで判定するため影響なし。
- **RLS の二重の守り（api-09）**：`Clients.user()` の service role への切り替えは、`cookies()` がリクエスト外で呼ばれたときの例外（Next の "was called outside a request scope"）に限定した。anon key 未設定などの設定ミスはそのまま例外にして、RLS を迂回しない。
- **F-8-1 年月ごとの記録（api-10）**：日単位の上限があるキー（ORS・Nominatim）は、停止判定に使う日の行に加えて年月（`YYYY-MM`）の行にも回数を加算する。月の行は記録のみで停止判定に使わない（`limit` は日の上限値をそのまま保存）。
- **未検証**：supabase モードの変更（`countByPost`、`getById`、`listByUser`、`finalizePostImages`、`Clients.user()`）は Supabase の実環境では未確認。SQL は `npm run db:validate`（ローカル PostGIS）で確認した。

## 5. レビュー後の判断（運用）

要件定義書との突き合わせレビュー（フェーズ 4）で挙がった運用・監視の指摘に対する判断。

- **F-8-3 / F-8-4 外部 API の自動再開の通知**（F6-3）：ORS / Nominatim の日単位の停止は日付の切替で自動的に解除される（F-8-4）が、アプリ側はその瞬間を検知する処理を持たない（期間ごとの行を見るだけ）。再開の通知は `keepalive-and-usage.yml`（毎日 5:15 JST）に寄せ、前日の `period` で `suspended_at` が入っている `api_usage` 行があり、当日の行が停止中でなければ「期間が切り替わったため ◯◯ を再開しました」をログと Discord に出す。アプリ（`src/lib/external/usage.ts`）は変更しない。容量（`post_create`）の再開通知は従来どおり同ジョブの使用量記録ステップで行う。
- **14 章 転送量（Egress）の監視**（F6-4）：Supabase の転送量は SQL から取れないため、ADR-0015 のとおり自動監視の対象は DB・Storage の容量だけとする。転送量は Supabase Dashboard > Settings > Usage の手動確認と Supabase の使用量メール通知で代替し、手順を `docs/setup.md` 5 章に記した。Management API（`/v1/projects/{ref}/usage`）をジョブから呼ぶ案は、アクセストークンの secret が増えることとエンドポイントの安定性を確認できていないため採用しない。80% を超えても停止はしない（閲覧を止めない。Q4）。
- **13 章 Sentry**（api-12）：Sentry は未導入（`@sentry/nextjs` なし、`instrumentation.ts` なし）。エラー検知は Vercel の Runtime Logs と各ワークフローの失敗通知（Discord）で代替し、確認手順を `docs/setup.md` 5 章「エラー監視」に記した。`src/lib/config.ts` の `serverConfig.sentryDsn` は契約ファイルのため削除せず予約として残す（`.env.example` と setup.md に「未使用」と明記）。導入するなら統合担当が依存を追加し `instrumentation.ts` で初期化する。
- **F-8-6 外部サービス側の上限（クォータ）設定**（F6-5）：設定できるサービスと設定値を `docs/setup.md` 5 章「サービス側の上限（クォータ）設定」に表で記した。方針は「サービス側の上限はアプリ側の停止値（`USAGE_LIMITS` の 80%）より少し大きくし、通常はアプリ側が先に止める」。OpenRouteService はトークンの上限を下げられる場合のみ 1,700 / 450 に設定し、Nominatim（公開サーバー）・Supabase Free・Vercel Hobby・Cloudflare R2 は設定項目が無いため設定不可とし、アプリ側の自主停止と手動確認で守る。Google Cloud は OAuth クライアントのみ使い、課金対象の API を有効にしないことを確認項目にした。GitHub Actions は spending limit `$0` を維持する。アプリのコードと `USAGE_LIMITS` は変更しない。

## 6. レビュー後の判断（経路作成）

要件定義書との突き合わせレビュー（フェーズ 4）で挙がった経路作成ロジック（`src/lib/planner`）の指摘に対する判断。

- **F-5-1 昼食休憩は 11:30〜13:30 の間だけ**（F5-03）：スポット出発直後の昼食は出発時刻が窓の中（`lunchWindowStart`〜`lunchWindowEnd`）のときだけ入れる。窓の前に到着して窓の終わりを過ぎるまで滞在する（1 つの滞在が窓を跨ぎ、空きが無い）ときは、窓の外（13:30 以降）には入れず昼食なしとする。窓の外の早めの昼食や滞在の分割、到着の繰り下げ（待ち時間）は行わない。昼食なしは `ScheduleResult.lunchSkipped`（planner 内部）と、画面でも同じ判定ができる純粋関数 `isLunchSkipped(lunchBreak, startMin, items)` で表し、`PlanResultView` に「昼食休憩を入れられませんでした（11:30〜13:30 の間に空きがありません）」を `coffee` アイコン付きで表示する。`PlanResult`（契約）には項目を増やさない（保存済みプランでも同じ判定で表示できる）。訪問順の探索は昼食の有無を点数に含めない（既知の制約）。
- **F-5 10 か所の計算時間**（F5-07）：11.7 の除外ループで「どれを外すか」の比較は、残りが 7 か所以上（`EXHAUSTIVE_COMPARE_MAX_SPOTS = 6` 超）なら全順列ではなく最近傍法＋2-opt／Or-opt の候補（`heuristicOrders`）だけで行い、外したあとに残った集合だけを従来どおり全探索（8 か所以下は全順列）で評価する。残りが 6 か所以下の比較は従来どおり全探索。手元の計測（`planner.test.ts`）では 10 か所・終了 15:00 が 1.69 秒 → 0.31 秒、10 か所・終了 11:00（除外 8 段）が 1.78 秒 → 0.27 秒。比較を近似にしたことで、どのスポットを外すかの選択が全探索と異なる場合があるが、最終的な訪問順は全探索で決めるため採用した順の品質は変わらない。本番（Vercel）での計測は未実施。

## 7. SNS 共有の方針（ADR-0020）

外部 API（LINE Messaging API、X API、Instagram Graph API など）の審査・連携は行わず、ブラウザの標準機能と OGP だけで LINE / X / Instagram への共有を実現する。

- **共有の入口は共通部品 `ShareButton`**（`src/components/share/ShareButton.tsx`）。スポット詳細（ヘッダー）、保存済みプラン（ヘッダーと「しおり画像を共有」）、リスト詳細の共有ダイアログ、共有リスト（ヘッダー）に置く。アイコンは `share-2`。
  - `navigator.share` がある端末（主にスマホ）は OS の共有シートを開く。画像がある場合は `navigator.canShare({ files })` で判定して PNG も渡す。
  - 無い環境（PC）は小さなダイアログで「リンクをコピー」（`navigator.clipboard`）、「Xで投稿」（`https://twitter.com/intent/tweet?text=&url=`）、「LINEで送る」（`https://social-plugins.line.me/lineit/share?url=`）を出す。既にダイアログの中にいるリストの共有では、入れ子を避けて同じ選択肢（`ShareOptions`）をダイアログ内に並べる。
  - 共有 URL はブラウザの `window.location.origin` を基準にした絶対 URL（`serverConfig.siteUrl` は使わない。共有 URL と同じ方針）。
- **リンクのカード表示は OGP**。`src/app/layout.tsx` に既定値（`metadataBase` = `serverConfig.siteUrl`、siteName「旅行どこいこう」、`ja_JP`、`twitter:card` = `summary_large_image`）、各ページの `generateMetadata` に `openGraph.title/description/url`（`src/lib/og/metadata.ts` の `pageOpenGraph`。Next.js は `openGraph` を深く併合しないため siteName / locale もここで付ける）。画像は `opengraph-image.tsx`（`next/og` の `ImageResponse`、1200x630）をスポット詳細・保存済みプラン・共有リストに置く。
  - **日本語フォント**：Satori に同梱されるのは英数（Geist）だけで日本語は描けない。`public/fonts/` にフォントを置かない方針のため、実行時に Google Fonts（`css2?family=Noto+Sans+JP&text=…`）から必要な文字だけのサブセット TTF を取得する（`src/lib/og/fonts.ts`。5 秒でタイムアウト、プロセス内でキャッシュ）。取得に失敗したら英数だけの文言（`asciiOnly`）で描く。
  - **背景写真**：スポットの代表写真を `fetch` して data URI にする（`src/lib/og/images.ts`）。memory モードの相対 URL（`/api/dev/files/…`、`/seed/photos/…`）は `serverConfig.siteUrl` を基準に絶対 URL にするため、`NEXT_PUBLIC_SITE_URL` が実際の URL と違うと写真なしのレイアウトになる（失敗時は写真なし）。
  - 保存済みプランの OGP 画像は本人以外も取得できる（UUID を知っている必要がある）が、載せるのは日付・スポット数・合計移動時間・移動手段の集計値だけで、スポット名や座標は出さない。プランのページ自体はログイン必須のため、LINE / X のクローラーは `/login` へリダイレクトされ、プランのカードは表示されない（既知の制約。リンク共有は本人の別端末・メモ用途）。
- **Instagram は画像で共有**。Instagram にはリンク共有の仕組みが無いため、保存済みプランの「旅のしおり画像」（`GET /api/v1/plans/{planId}/image`、本人のみ、1080x1920 の PNG。タイトル・日付・タイムライン・サービス名）を `ShareButton` の `imageBlob` として共有シートに渡し、ユーザーが Instagram ストーリー等を選ぶ。PC では `<a download>` でダウンロードする。
- **8.1 アイコン対応表の追加**：リンクをコピー → `copy`、画像を保存 → `download`（`src/components/ui/icons.tsx`）。
