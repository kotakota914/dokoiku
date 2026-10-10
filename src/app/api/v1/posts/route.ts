/**
 * POST /api/v1/posts（9.3、F-2）
 * 投稿作成（新規スポット作成を含む）。ログイン必須。
 * 201 { post: PostView, spotId }。重複スポットは 409（details.candidates）、停止中は 503、投稿しすぎは 429。
 */
import { created, parseBody, route } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/server";
import { getRepo } from "@/lib/repo";
import { createPost } from "@/lib/services/posts";
import { createPostSchema } from "@/lib/validation/schemas";

export const POST = route(async (req) => {
  const user = await requireUser();
  const input = await parseBody(req, createPostSchema);
  const repo = await getRepo();
  return created(await createPost(repo, user.id, input));
});
