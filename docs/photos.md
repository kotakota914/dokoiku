# 写真の入れ方

初期データ（金沢）の写真と、チームで撮った写真をアプリに入れる手順。
スクリプトはすべて `scripts/seed/` にあり、リポジトリ直下で `node scripts/seed/<名前>.mjs` として実行する（Node 20 以上。`package.json` の npm scripts には登録しない）。
依存は導入済みの `sharp`、`exifr`、`@supabase/supabase-js` と Node の標準ライブラリだけなので、`npm ci` が済んでいれば追加の準備は不要。

Windows の PowerShell で日本語の表示が崩れる場合は、先に次を実行する。

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
```

## 1. 著作権の注意（必ず読む）

- **Google 画像検索などで見つけた写真は使えない。** 検索結果に出る写真の大半は撮影者に著作権があり、無断で複製・配布（アプリに載せること）はできない。デモ用でも同じ。
- **Wikimedia Commons の写真は、ライセンスの条件を守れば使える。** このリポジトリで採用するのは CC0、CC BY 2.0〜4.0、CC BY-SA 2.0〜4.0、パブリックドメインのみ。NC（非営利限定）・ND（改変禁止。リサイズも改変にあたる）は採用しない。
  - CC BY / CC BY-SA は **作者名・ライセンス名・出典へのリンクを表示する義務** がある。`scripts/seed/fetch-commons-photos.mjs` が `docs/photo-credits.md` に一覧を生成するので、これを削除・改変しない。アプリ内で表示する場合もこの一覧を参照できるようにする。
  - CC BY-SA の写真を改変して再配布する場合は、同じライセンス（BY-SA）で公開する必要がある。
- **自分たちで撮った写真が最善。** 権利の問題がなく、学内スポット（金沢工業大学）は Commons にほぼ無いので撮影して入れる。人物の顔が写っている写真は本人の許可がない限り使わない。EXIF（位置情報・撮影日時）は取り込み時に除去される。

## 2. Wikimedia Commons から取得する（fetch-commons-photos）

`seed-data/kanazawa/spots.json` の各スポットに書かれた `commons.categories`（Commons のカテゴリ名）と `commons.search`（全文検索の語）をもとに候補を集め、ライセンス・形式・サイズの条件を満たす写真だけを取得する。`commons` が `null` のスポット（学内スポットなど）は飛ばす。

```powershell
# 連絡先を User-Agent に入れる（Wikimedia の API 利用ポリシー）
$env:SEED_CONTACT = "you@example.com"

# まず候補とライセンスだけ確認する（ダウンロードしない）
node scripts/seed/fetch-commons-photos.mjs --dry-run

# 取得する（1 スポット最大 4 枚。--per-spot で変更）
node scripts/seed/fetch-commons-photos.mjs

# 1 スポットだけ取り直す
node scripts/seed/fetch-commons-photos.mjs --spot kenrokuen --per-spot 6 --overwrite
```

| オプション     | 意味                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `--spot <key>` | `spots.json` の `key` が一致するスポットだけ処理する                                                                            |
| `--per-spot N` | 1 スポットあたりの最大枚数（既定 4）                                                                                            |
| `--dry-run`    | 候補の題名・ライセンス・サイズ・推定した季節と時間帯を表示するだけ                                                              |
| `--overwrite`  | そのスポットの既存ファイルと `photos.json` の行を捨てて取り直す。指定しなければ既存の続きの番号で追加し、取得済みの出典は飛ばす |

出力：

- `public/seed/photos/<key>/<n>.webp`（長辺 1600px）と `<n>_t.webp`（長辺 400px）。sharp で再エンコードするので EXIF は残らない。
- `seed-data/kanazawa/photos.json`：1 枚 1 行。`spotKey, file, fullPath, thumbPath, width, height, title, author, license, licenseUrl, sourceUrl, season, timeOfDay`。既存があればマージ（同じ `fullPath` は上書き）。
- `docs/photo-credits.md`：スポットごとの作者・ライセンス・出典の表。

季節（`season`：winter / spring / autumn / summer / null）と時間帯（`timeOfDay`：day / night）は題名・説明・カテゴリの語から推定し、同じスポットではできるだけ異なる組み合わせを優先して選ぶ。推定なので、`--dry-run` の表示を見て明らかに違うものがあれば `spots.json` の `search` に「雪」「ライトアップ」などの語を足して取り直す。

Commons API へのリクエストは 200ms 間隔。失敗したスポットは飛ばして最後に一覧で表示するので、`--spot` で個別に再実行する。

## 3. チームで撮った写真を取り込む（import-posts）

写真フォルダと一覧表 CSV を用意し、投稿として一括登録する。

### 3.1 CSV の書き方

テンプレート：`seed-data/import-template.csv`（UTF-8。Excel で編集した場合は「CSV UTF-8」で保存する）。

```csv
file,spot,category,stay,comment,lat,lng,taken_at
IMG_0001.jpg,兼六園,nature,lt120,霞ヶ池のまわりは午前中が歩きやすかったです,,,
IMG_0002.jpg,金沢工業大学 ライブラリーセンター,other,lt120,試験前は上の階の自習席が埋まるので早めに,36.5338,136.6272,2026-10-05T14:30:00+09:00
```

| 列          | 内容                                                                                                                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `file`      | 写真フォルダからの相対パス（JPEG / PNG / HEIC 以外の形式は sharp が読める範囲。HEIC は事前に JPEG へ変換する）                                                                                  |
| `spot`      | 既存スポット名（seed の `name` と完全一致）または新規スポット名（1〜50 文字）                                                                                                                   |
| `category`  | `nature` / `gourmet` / `history` / `photogenic` / `other`                                                                                                                                       |
| `stay`      | `lt30` / `lt60` / `lt120` / `half_day` / 空                                                                                                                                                     |
| `comment`   | 150 文字以内。カンマや改行を含むときは `"` で囲む                                                                                                                                               |
| `lat`,`lng` | 空なら写真の EXIF（GPS）→ 既存スポットの座標 の順に補う。**新規スポットで EXIF に GPS が無ければ必須**                                                                                          |
| `taken_at`  | 撮影日時（ISO 8601、例 `2026-10-05T14:30:00+09:00`）。空なら EXIF の撮影日時。memory では投稿時刻は API が付けるため参考情報、supabase では `posts.created_at` に入る（時間帯分布に反映される） |

1 行 1 投稿（写真 1 枚）。同じスポットに複数枚入れるときは行を分ける。

### 3.2 ローカル（memory モード）に入れる

アプリを `npm run dev`（`DATA_BACKEND=memory`）で起動した状態で実行する。開発用ログイン（`POST /api/dev/login`）で Cookie を取り、`POST /api/v1/uploads` → 署名付き URL へ `PUT` → `POST /api/v1/posts` の順に、ブラウザと同じ API を通す。

```powershell
# 変換と検証だけ（送信しない）
node scripts/seed/import-posts.mjs --photos .\my-photos --csv .\my-photos\list.csv --dry-run

# 取り込む（投稿者は既定で開発ユーザーA）
node scripts/seed/import-posts.mjs --photos .\my-photos --csv .\my-photos\list.csv

# 別の開発ユーザーで、別ポートのアプリへ
node scripts/seed/import-posts.mjs --photos .\my-photos --csv .\my-photos\list.csv --user a0000000-0000-4000-8000-000000000002 --base-url http://localhost:3001
```

- 既存スポットは `GET /api/v1/places/search?q=<spot>` の `source: "db"` の結果から名前で引く。無ければ新規スポットとして作る（半径 50m 内に似た名前があれば API が 409 を返すので、その候補へ投稿し直す）。
- 投稿の API はレート制限（1 分あたりの投稿数）があるので、大量に入れるときは失敗した行を再実行する。
- 結果は「成功 n 件、失敗の理由一覧」で表示する。

### 3.3 Supabase に入れる

service role で Storage と DB に直接書き込む。`--user` には投稿者にする `profiles.id`（Google ログイン済みのユーザー）を指定する。

```powershell
$env:NEXT_PUBLIC_SUPABASE_URL = "https://<project>.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "<service role key>"
node scripts/seed/import-posts.mjs --photos .\my-photos --csv .\my-photos\list.csv --target supabase --user <profiles.id>
```

- 画像は `post-images` バケットの `posts/<postId>/<imageId>.webp` と `_t.webp` に置く（アプリのアップロードと同じ配置）。
- スポットは `spots.name` の完全一致で探し、無ければ `location` を `SRID=4326;POINT(lng lat)` で作成する。最後に `recompute_spot_stats` を呼んで投稿数・代表写真・時間帯分布を更新する。
- service role key はサーバー専用。コミットしない、画面に貼らない。

## 4. Supabase に初期データの写真を反映する（upload-seed-photos）

`supabase/seed.sql` の投稿は `seed/photos/<key>/<n>.webp` のパスを参照する。`public/seed/photos` 配下の WebP を同じパスで Storage にアップロードする。

```powershell
$env:NEXT_PUBLIC_SUPABASE_URL = "https://<project>.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "<service role key>"
node scripts/seed/upload-seed-photos.mjs --dry-run   # 対象を確認
node scripts/seed/upload-seed-photos.mjs             # アップロード（同じパスは上書き）
```

順番は「2 章で写真を取得 → `supabase/seed.sql` を流す → 4 章でアップロード」。先に seed.sql を流しても、写真が無い間はカテゴリのアイコンで代替表示される。

## 5. 学内スポット（金沢工業大学）の撮影リストの例

Commons に写真が無いので、チームで撮って 3 章の手順で入れる。`spots.json` の `kit-*` のスポット名に合わせると既存スポットとして紐づく。いろいろな季節・時間帯・天気を混ぜると、時間帯分布と写真の多様性がデモで分かりやすい。

| スポット名（`spots.json` の `name`）   | category   | 撮りたいもの                               | 時間帯・季節の例                            |
| -------------------------------------- | ---------- | ------------------------------------------ | ------------------------------------------- |
| 金沢工業大学 正門                      | photogenic | 正門と校名の表示、並木                     | 朝の通学時間、夕暮れ、雪の日                |
| 金沢工業大学 学生食堂 ラテラ（21号館） | gourmet    | 日替わり定食、混み具合、券売機まわり       | 11:30 の開店直後、13 時過ぎ、100 円朝食の朝 |
| 金沢工業大学 学内カフェ                | gourmet    | 飲み物と席、窓からの景色                   | 午後の空き時間、夕方                        |
| 金沢工業大学 ライブラリーセンター      | other      | 自習席、書架、入口                         | 平日の午後、試験期間の夜、休日              |
| 金沢工業大学 夢考房41                  | other      | 作業スペース、展示されているロボットや車両 | 平日の夕方（活動時間）                      |
| 金沢工業大学 23号館                    | other      | 講義室前の通路、休憩スペース               | 授業の合間、雨の日                          |
| 金沢工業大学 8号館                     | other      | 外観、周辺の広場                           | 新緑、紅葉                                  |
| 金沢工業大学 学生ラウンジ              | other      | ソファ席、電源のある席                     | 昼休み、放課後                              |

CSV の例：

```csv
file,spot,category,stay,comment,lat,lng,taken_at
latera_1.jpg,金沢工業大学 学生食堂 ラテラ（21号館）,gourmet,lt30,開店直後なら並ばずに座れました,,,2026-10-06T11:35:00+09:00
latera_2.jpg,金沢工業大学 学生食堂 ラテラ（21号館）,gourmet,lt30,13時を過ぎると空いています,,,2026-10-07T13:20:00+09:00
library_1.jpg,金沢工業大学 ライブラリーセンター,other,lt120,窓側の自習席は午前中が取りやすいです,,,2026-10-08T10:05:00+09:00
library_2.jpg,金沢工業大学 ライブラリーセンター,other,half_day,試験前の夜は上の階まで埋まります,,,2026-10-20T20:10:00+09:00
```

撮影時の注意：人物の顔が判別できる写真は使わない。掲示物や個人の持ち物が写らないようにする。施設の撮影ルールがある場所（図書館の館内など）は事前に確認する。
