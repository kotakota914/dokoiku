/**
 * GET /api/v1/spots/search?q=&prefecture=&city=&category=&sort=popular|newest&cursor=&limit=（F-3-6）
 * Page<SpotSummary>。ログイン不要。
 */
import { json, parseQuery, route } from "@/lib/api/handler";
import { getRepo } from "@/lib/repo";
import { searchSpots } from "@/lib/services/spots";
import { spotSearchQuerySchema } from "@/lib/validation/schemas";

export const GET = route(async (req) => {
  const query = parseQuery(req, spotSearchQuerySchema);
  const repo = await getRepo();
  return json(await searchSpots(repo, query));
});
