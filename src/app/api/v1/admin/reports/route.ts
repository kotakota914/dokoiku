/**
 * GET /api/v1/admin/reports?cursor=&limit=  未処理の通報一覧（F-7-3。管理者のみ）
 * Page<Report & { post: PostView | null }>
 */
import { json, parseQuery, route } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/auth/server";
import { getRepo } from "@/lib/repo";
import { listOpenReports } from "@/lib/services/reports";
import { pagingQuerySchema } from "@/lib/validation/schemas";

export const GET = route(async (req) => {
  await requireAdmin();
  const { cursor, limit } = parseQuery(req, pagingQuerySchema);
  const repo = await getRepo();
  return json(await listOpenReports(repo, { cursor, limit }));
});
