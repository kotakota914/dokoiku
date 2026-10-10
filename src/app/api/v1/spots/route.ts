/**
 * GET /api/v1/spots?bbox=minLng,minLat,maxLng,maxLat&zoom=&category=a,b（9.3、F-1）
 * zoom <= 8 はヒートマップ用の点、それ以外はスポット一覧（最大 2,000 件、投稿数の多い順）。ログイン不要。
 */
import { json, parseQuery, route } from "@/lib/api/handler";
import { getRepo } from "@/lib/repo";
import { getSpotsInView } from "@/lib/services/spots";
import { spotsInViewQuerySchema } from "@/lib/validation/schemas";

export const GET = route(async (req) => {
  const query = parseQuery(req, spotsInViewQuerySchema);
  const repo = await getRepo();
  return json(await getSpotsInView(repo, query));
});
