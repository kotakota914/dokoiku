/**
 * GET /api/v1/spots/nearby?lat=&lng=&accuracy=&radius=（F-2-6、Q7）
 * 現在地から radius（既定 100m、最大 300m）以内のスポットを近い順に最大 10 件。ログイン必須。
 * accuracy が 100m 以上なら canCreate: false（新規スポット登録不可）。現在地は保存しない。
 */
import { json, parseQuery, route } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/server";
import { getRepo } from "@/lib/repo";
import { getNearbySpots } from "@/lib/services/spots";
import { nearbyQuerySchema } from "@/lib/validation/schemas";

export const GET = route(async (req) => {
  await requireUser();
  const query = parseQuery(req, nearbyQuerySchema);
  const repo = await getRepo();
  return json(await getNearbySpots(repo, query));
});
