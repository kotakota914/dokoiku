# 引き継ぎ資料（2026-10-22 時点）

先輩（かずや・ぜんき）向けの入口。最初にこのファイルを読み、必要に応じてリンク先へ進む。

## 1. いまの状態（ひとことで）

要件定義書 v0.3（2026/10/21）の機能はひととおり動く。Supabase と外部 API（Google Routes / Gemini / OpenRouteService）は**キーを入れて本物で試す段階**で、コードはキーが無くても代替動作（概算・停止中表示）で動く。

| 確認 | 結果（`main` の a35c205 時点） |
| --- | --- |
| `npm run check`（typecheck・lint・単体テスト 558 件） | 成功 |
| `npm run build` | 成功 |
| `npm run test:e2e`（Playwright、スマホ・PC 38 件） | 成功 |
| `npm run db:validate`（ローカル PostgreSQL＋PostGIS で migration 0001〜0003） | 成功 |

## 2. 最初の 15 分（手元で動かす）

必要なもの：Node.js 22 以上、Git。

```bash
git clone https://github.com/kotakota914/dokoiku.git
cd dokoiku
cp .env.example .env      # Windows は copy .env.example .env
npm install
npm run dev               # http://localhost:3000
```

- ログインは `/login` の「開発用ログイン」からユーザーを選ぶ（Google ログイン不要）。
- データは `DATA_BACKEND` 未設定なら **memory モード**（`.data/memory.json` に保存）。初期データに戻すときは `.data` フォルダを消して再起動。
- 外部 API を使わずに全機能（AIと相談を含む）を試すなら `.env` に `EXTERNAL_API_MOCK=true`。仮の応答（`mock-data/external/`）で動く。

デモの流れ：地図（金沢）→ 写真ピン → スポット詳細 → リストに追加（3〜4 件）→ リストで拠点「金沢駅」を設定 → 経路を作成 → おまかせ → 3 案を比較 → 保存 → 「ナビを開始」。

## 3. 読む順番

1. `AGENTS.md`：開発ルール、15 章の決定事項（v0.1 と v0.3）、**勝手に変えない契約ファイル**の一覧。
2. `docs/v0.3-diff.md`：v0.3 で何がどこに入ったか（領域ごとのファイル一覧）。
3. `docs/要件定義書.md`：仕様の正。旧版は `docs/archive/`。
4. `docs/decisions.md`：採用した判断（ADR-0013〜0026）と「v0.3 実装時の判断」。
5. 必要に応じて `docs/setup.md`（環境変数・運用）、`docs/supabase-setup.md`（Supabase 接続と Cron）、`docs/photos.md`（写真の取り込み）。

## 4. コードの地図

| やりたいこと | 見る場所 |
| --- | --- |
| 定数・型・入力チェック（契約） | `src/lib/domain/`、`src/lib/validation/schemas.ts`、`src/lib/repo/types.ts` |
| API（`/api/v1/**`） | `src/app/api/v1/` → 中身は `src/lib/services/*.ts` |
| データ保存（memory / Supabase） | `src/lib/repo/memory/`、`src/lib/repo/supabase/`、`supabase/migrations/` |
| 経路作成のロジック（全探索・点数・3 案） | `src/lib/planner/`（純粋関数。重みは `PRIORITY_WEIGHTS`） |
| 外部 API（ORS / Google Routes / Gemini / Nominatim / モック / 無料枠） | `src/lib/external/` |
| 地図 | `src/components/map/`、`src/lib/map/`（タイル取得と区画キャッシュ） |
| 画面 | `src/app/**/page.tsx` と `src/components/<機能>/` |
| 共通 UI 部品・アイコン | `src/components/ui/`（アイコンは lucide のみ、`Icon` 部品） |
| テスト | 単体は各ファイルの隣の `*.test.ts(x)`、E2E は `e2e/` |

## 5. 残っている作業（優先度順）

### Hack Day（10/24〜25）までに

1. **API キーを取得して本物で確認**（キーは `.env` と GitHub Secrets だけに置き、コミットしない）
   - `GOOGLE_ROUTES_API_KEY`：金沢駅→兼六園、兼六園→ひがし茶屋街で公共交通の時間が返るか（要件 15 章 Q2）。返らなければ概算のままでよい（決定済み）。
   - `GEMINI_API_KEY`：「AIと相談」で「夕日は金沢港で見たい」などが条件に変換されるか。
   - `ORS_API_KEY`：徒歩・車の移動時間。
2. **デプロイ方針を決める**：memory モードのまま Vercel に出すか、Supabase につなぐか。Supabase なら `docs/supabase-setup.md` の手順（migration 0001〜0003、seed、10 節の Cron）。
3. **初期データの写真**：プレースホルダーのスポットがある。チーム撮影の写真（特に金沢工業大学の学内 8 件）を `docs/photos.md` の手順で取り込む。
4. **重みの調整**（要件 11.3）：金沢のデータで 3〜4 パターン作り、案が自然か確認して `src/lib/domain/constants.ts` の `PRIORITY_WEIGHTS` を調整。

### チームで決めること

- 地図でリストを強調中にカテゴリで絞り込むと、絞り込みに合わないリストのスポットは表示しない（仮決め）。
- ズーム 8 以下（ヒートマップ）では、リストの強調は拠点マーカーだけになる（仮決め）。
- 公共交通の「休日」は土日のみで祝日は扱わない。

### 既知の制約（急がない）

- 存在しないページは「見つかりません」を表示するが HTTP ステータスは 200（ルートの `loading.tsx` によるストリーミングのため。noindex 付き）。
- レート制限はサーバーのメモリ内（Vercel の複数インスタンスでは厳密でない）。
- `mock-data/external/*.json` は代表値で作った仮データ。実 API の応答を記録したら差し替える。
- アイコンの仮の包み（`src/components/list/listIcons.tsx`、`src/components/plan/PlanIcon.tsx`）は共通の `Icon` に置き換え可能。

## 6. 作業の進め方

- `main` に直接 push せず、目的ごとにブランチを切って Pull Request にする（1 PR 1 目的）。
- push 前に `npm run check`。画面の導線を変えたら `npm run test:e2e`、DB を変えたら `npm run db:validate`。
- 契約ファイル（`AGENTS.md` 3 節）を変えるときは PR に「契約変更」と書いて全員に知らせる。
- 秘密情報（API キー、Supabase の service role key）はコミットしない。`.env` は `.gitignore` 済み。
