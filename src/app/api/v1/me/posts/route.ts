/**
 * GET /api/v1/me/posts?cursor=&limit=
 * 自分の投稿一覧（新着順、hidden も含む）。Page<PostView>
 */
import { json, parseQuery, route } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/server";
import { getRepo } from "@/lib/repo";
import { pagingQuerySchema } from "@/lib/validation/schemas";

export const GET = route(async (req) => {
  const user = await requireUser();
  const { cursor, limit } = parseQuery(req, pagingQuerySchema);
  const repo = await getRepo();
  const page = await repo.posts.listByUser(user.id, { cursor, limit }, user.id);
  return json(page);
});
