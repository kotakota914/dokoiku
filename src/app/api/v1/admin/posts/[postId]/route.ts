/**
 * PATCH /api/v1/admin/posts/{postId}  投稿の非表示・再表示（F-7-3。管理者のみ）→ PostView
 * 再表示（public）するときは、その投稿の未処理の通報を解決済みにする。
 */
import { json, parseBody, route } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/auth/server";
import { getRepo } from "@/lib/repo";
import { adminSetPostStatus } from "@/lib/services/posts";
import { adminPostPatchSchema, uuidSchema } from "@/lib/validation/schemas";

export const PATCH = route<{ postId: string }>(async (req, { params }) => {
  const admin = await requireAdmin();
  const postId = uuidSchema.parse((await params).postId);
  const { status } = await parseBody(req, adminPostPatchSchema);
  const repo = await getRepo();
  return json(await adminSetPostStatus(repo, admin.id, postId, status));
});
