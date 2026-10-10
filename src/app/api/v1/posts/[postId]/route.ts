/**
 * PATCH  /api/v1/posts/{postId}  投稿編集（F-2-12。本人のみ）→ PostView
 * DELETE /api/v1/posts/{postId}  投稿削除（本人または管理者）→ 204
 */
import { json, noContent, parseBody, route } from "@/lib/api/handler";
import { requireProfile } from "@/lib/auth/server";
import { getRepo } from "@/lib/repo";
import { deletePost, updatePost } from "@/lib/services/posts";
import { updatePostSchema, uuidSchema } from "@/lib/validation/schemas";

export const PATCH = route<{ postId: string }>(async (req, { params }) => {
  const user = await requireProfile();
  const postId = uuidSchema.parse((await params).postId);
  const input = await parseBody(req, updatePostSchema);
  const repo = await getRepo();
  return json(await updatePost(repo, user.id, postId, input));
});

export const DELETE = route<{ postId: string }>(async (_req, { params }) => {
  const user = await requireProfile();
  const postId = uuidSchema.parse((await params).postId);
  const repo = await getRepo();
  await deletePost(repo, { id: user.id, isAdmin: user.isAdmin }, postId);
  return noContent();
});
