/**
 * POST /api/v1/uploads（9.3、F-2-4）
 * 写真アップロード用の署名付き URL を発行する。ログイン必須。停止中（post_create）は 503。
 */
import { json, parseBody, route } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/server";
import { getRepo } from "@/lib/repo";
import { requestUploads } from "@/lib/services/uploads";
import { uploadRequestSchema } from "@/lib/validation/schemas";

export const POST = route(async (req) => {
  const user = await requireUser();
  const input = await parseBody(req, uploadRequestSchema);
  const repo = await getRepo();
  return json(await requestUploads(repo, user.id, input));
});
