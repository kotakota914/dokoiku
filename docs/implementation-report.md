# 実装報告

## v0.3 対応（2026-10-22）

要件定義書 v0.3（2026/10/21 更新）に合わせて実装を更新した。差分と分担は `docs/v0.3-diff.md`、判断は `docs/decisions.md` の 8 節（ADR-0021〜0026 と「v0.3 実装時の判断」）。

| 項目 | 結果 |
| --- | --- |
| `npm run typecheck` / `npm run lint` | 成功 |
| `npx vitest run` | 53 ファイル / 558 件 成功 |
| `npm run build` | 成功 |
| `npx playwright test`（memory モード） | 38 件 成功（mobile 19 / desktop 19） |
| `npm run db:validate` | 成功（migration 0003 を含む） |

主な変更：経路作成は最大 8 か所・全探索・最大 3 案（おまかせ / 重視するものを選ぶ / AIと相談）、移動手段に公共交通（Google Routes、未設定時は概算）、AIと相談（Gemini、未設定時は停止中表示）、保存済みプランの「ナビを開始」、リストの拠点・距離・並べ替え・比較・合計滞在時間、地図のタイル取得と区画キャッシュ、人気度の相対順位、位置情報拒否時の金沢初期表示、外部 API のモック（`EXTERNAL_API_MOCK`）。

未確認：Google Routes で日本の公共交通の移動時間が返るか（15章 Q2。キー取得後に金沢駅→兼六園などで確認）、Gemini の実応答、Supabase の Cron 登録（`docs/supabase-setup.md` 10 節）。

---

# 初回実装（2026-10-10）

要件定義書 v0.1（`docs/要件定義書.md`）を、15章の推奨案をすべて採用した前提で一通り実装した。本書は「何ができていて、何が未確認か」をチームが把握するためのもの。採用した判断は `docs/decisions.md`、起動手順は `docs/setup.md` を参照。

## 1. 検証結果（最終状態）

| 項目 | 結果 |
| --- | --- |
| `npm run typecheck` | 成功（エラー 0） |
| `npm run lint` | 成功（警告・エラー 0） |
| `npm run test`（Vitest） | 36 ファイル / 360 件 成功 |
| `npm run build`（Next.js 16, Turbopack） | 成功（33 ルート） |
| `npm run test:e2e`（Playwright, memory モード） | 30 件 成功（mobile 15 / desktop 15） |
| `npm run db:validate`（ローカル PostGIS で migration・seed・RLS） | 成功 |

## 2. 実装範囲

| 段階 | 機能 | 状態 |
| --- | --- | --- |
| MVP | F-1 マップ表示（ヒートマップ／写真の束／写真ピン） | 実装・E2E 済み |
| MVP | F-2 スポット投稿（4 ステップ、WebP 変換、EXIF 除去、GPS／検索） | 実装・E2E 済み |
| MVP | F-3 スポット詳細（閲覧） | 実装・E2E 済み |
| MVP | F-6 認証（Google ログイン／開発用ログイン）、マイページ、退会 | 実装（Google は未検証） |
| MVP | F-8 無料枠管理（80% で停止、通知） | 実装・単体テスト済み |
| MVP | F-9 バックアップ（GitHub Actions） | 作成済み・未実行 |
| β | F-3 検索・いいね | 実装・E2E 済み |
| β | F-4 行きたい場所リスト | 実装・E2E 済み |
| β | F-5 経路作成（全探索／2-opt、昼食、おすすめ時間帯、再計算、保存） | 実装・E2E 済み（外部 API は概算で代替） |
| 正式 | F-4 共有 URL | 実装 |
| 正式 | F-7 通報・管理 API（管理画面なし） | 実装 |
| 追加 | SNS 共有（Web Share API ＋ OGP 画像、しおり画像で Instagram。外部 API なし。ADR-0020） | 実装・単体テスト済み |

要件レビュー（要件 ID ごとの突き合わせ）では、確定した指摘 12 件（うち重大 1 件：保存プランに現在地の座標がそのまま残る）と低優先 43 件を修正した。残った判断事項は `docs/decisions.md` の「レビュー後の判断」にある。

## 3. 動かし方（最短）

```bash
cp .env.example .env        # DATA_BACKEND=memory のまま
npm install
npm run dev                 # http://localhost:3000
```

ログインは `/login` の「開発用ログイン」からユーザーを選ぶ。初期データは金沢市・野々市市の 44 スポット（金沢工業大学 扇が丘キャンパスの学内スポット 8 件を含む）・約 350 投稿。元データは `seed-data/kanazawa/spots.json`（memory の seed・`supabase/seed.sql`・写真取得ツールの共通ソース）。写真は `seed-data/kanazawa/photos.json` にあれば `public/seed/photos/` の実写真、無ければ自動生成のプレースホルダー。Supabase を使う場合は `docs/supabase-setup.md`。

## 4. 未確認・既知の制約（優先度順）

1. **Supabase モードは実環境で未検証。** migration・RLS・RPC はローカル PostGIS で検証したが、Supabase プロジェクト、Google ログイン（`/auth/callback`）、Storage への署名付きアップロード、退会時の `auth.admin.deleteUser` は未接続。Hack Day 前に 1 度つないで確認すること。
2. **外部 API（OpenRouteService / Nominatim）は未検証。** 開発環境から到達できなかったため、代替動作（直線距離×係数の概算、自前 DB 検索）だけを確認した。キーを設定したら経路作成と場所検索を実際に試すこと。
3. **初期データの写真は `photos.json` が無い間はプレースホルダー。** memory モードは SVG を動的生成、`supabase/seed.sql` は `seed/photos/<key>/<n>.webp` の予定パスだけ登録している。写真取得ツールで `public/seed/photos/` と `photos.json` を作ると実写真になる。金沢工業大学の学内スポット（`commons: null`）はチームで撮影して差し替える（Q16）。
4. **GitHub Actions は未実行。** secrets（DB 接続、R2、Webhook）を設定してから手動実行で確認する。`.github/workflows/` はリポジトリ直下に置く前提。
5. **存在しないスポットの HTTP ステータスは 200**（ルートの `loading.tsx` によるストリーミングのため）。表示は「このスポットは見つかりませんでした」になる。
6. **レート制限はサーバーインスタンス内のメモリ**で行う（投稿数は DB でも確認）。Vercel の複数インスタンスでは厳密でない。
7. **再計算（並び替え）後の営業時間外到着は警告しない**（終了時刻超過は警告・保存不可）。営業時間自体が MVP では未設定なので実害はない。
8. **PC の 2 カラム（左パネル＋右地図）はトップのみ。** 詳細・リストは通常ページ。
9. **Sentry は未導入**（Vercel のログと Actions の失敗通知で代替。`docs/setup.md` 参照）。
10. **MapLibre のワーカー**は `node_modules` への相対パスで取り込んでいる（Turbopack 対策）。モノレポ化などで位置が変わる場合は `src/components/map/workerUrl.ts` を直す。

## 5. チームへの引き継ぎ

- **フロント担当**：デザイントークンは `src/app/globals.css`（メインカラーは仮の空色、コントラスト 4.5 以上に調整済み）。部品は `src/components/ui`。
- **API / データ担当**：画面・API は `src/lib/repo/types.ts` の Repository 契約だけに依存する。Supabase 側の追加は `supabase/migrations/` と `src/lib/repo/supabase/`。
- **運用担当**：`docs/setup.md` の環境変数・secrets 一覧と無料枠の確認項目（14章）。
- **デモ導線**：地図（金沢にズーム）→ 写真ピン → 詳細 → 「行きたい場所リストに追加」→ リスト詳細 → 「経路を作成」→ タイムライン → 保存。E2E の `e2e/list-plan.spec.ts` がそのまま台本になる。
