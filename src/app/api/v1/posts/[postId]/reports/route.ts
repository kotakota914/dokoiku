/**
 * POST /api/v1/posts/{postId}/reports  通報（F-7-1、F-7-2）→ 201 { count, hidden }
 * 自分の投稿は 403、二重通報は 409。3 件で自動非表示（Q13）。
 */
import { created, parseBody, route } from "@/lib/api/handler";
import { requireProfile } from "@/lib/auth/server";
import { getRepo } from "@/lib/repo";
import { reportPost } from "@/lib/services/reports";
import { createReportSchema, uuidSchema } from "@/lib/validation/schemas";

export const POST = route<{ postId: string }>(async (req, { params }) => {
  const user = await requireProfile();
  const postId = uuidSchema.parse((await params).postId);
  const input = await parseBody(req, createReportSchema);
  const repo = await getRepo();
  return created(await reportPost(repo, user.id, postId, input));
});
