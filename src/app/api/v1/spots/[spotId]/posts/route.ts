/**
 * GET /api/v1/spots/{spotId}/posts?cursor=&limit=（F-3-2）
 * スポットの投稿一覧（新着順、20 件ずつ）。Page<PostView>。ログイン不要だが、ログイン中なら likedByMe と
 * 自分の非表示投稿が反映される。スポットが無ければ 404。
 */
import { json, parseQuery, route } from "@/lib/api/handler";
import { getCurrentUser } from "@/lib/auth/server";
import { getRepo } from "@/lib/repo";
import { listSpotPosts } from "@/lib/services/spots";
import { pagingQuerySchema, uuidSchema } from "@/lib/validation/schemas";

export const GET = route<{ spotId: string }>(async (req, { params }) => {
  const spotId = uuidSchema.parse((await params).spotId);
  const { cursor, limit } = parseQuery(req, pagingQuerySchema);
  const viewer = await getCurrentUser();
  const repo = await getRepo();
  return json(await listSpotPosts(repo, spotId, { cursor, limit }, viewer?.id ?? null));
});
