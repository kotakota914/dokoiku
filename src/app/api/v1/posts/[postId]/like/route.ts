/**
 * PUT    /api/v1/posts/{postId}/like  いいね（F-3-3。冪等）→ { likeCount }
 * DELETE /api/v1/posts/{postId}/like  いいね取り消し → { likeCount }
 */
import { json, route } from "@/lib/api/handler";
import { requireProfile } from "@/lib/auth/server";
import { getRepo } from "@/lib/repo";
import { likePost, unlikePost } from "@/lib/services/posts";
import { uuidSchema } from "@/lib/validation/schemas";

export const PUT = route<{ postId: string }>(async (_req, { params }) => {
  const user = await requireProfile();
  const postId = uuidSchema.parse((await params).postId);
  const repo = await getRepo();
  return json(await likePost(repo, user.id, postId));
});

export const DELETE = route<{ postId: string }>(async (_req, { params }) => {
  const user = await requireProfile();
  const postId = uuidSchema.parse((await params).postId);
  const repo = await getRepo();
  return json(await unlikePost(repo, user.id, postId));
});
