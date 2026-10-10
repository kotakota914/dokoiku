/**
 * GET /api/v1/places/search?q=&lat=&lng=（F-2-7 / F-5-1、Q6）
 * 自前DB優先＋Nominatim の場所検索。ログイン必須。「検索」ボタン押下時にだけ呼ぶこと（自動補完に使わない）。
 * - 外部検索は全体で 1 秒 1 回。超えると 429
 * - 外部検索が停止中・無効・失敗のときは externalUnavailable: true で自前DBの結果だけ返す（200）
 */
import { json, parseQuery, route } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/server";
import { getRepo } from "@/lib/repo";
import { searchPlaceCandidates } from "@/lib/services/places";
import { placesSearchQuerySchema } from "@/lib/validation/schemas";

export const GET = route(async (req) => {
  await requireUser();
  const query = parseQuery(req, placesSearchQuerySchema);
  const repo = await getRepo();
  return json(await searchPlaceCandidates(repo, query), { headers: { "Cache-Control": "no-store" } });
});
