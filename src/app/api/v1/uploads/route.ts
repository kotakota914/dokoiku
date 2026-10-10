/**
 * POST /api/v1/uploads（9.3、F-2-4）
 * 写真アップロード用の署名付き URL を発行する。ログイン必須（プロフィール未作成は 403）。停止中（post_create）は 503。
 * 変換後サイズが 2MB を超える申告は 413 PAYLOAD_TOO_LARGE。
 */
import { json, parseBody, route } from "@/lib/api/handler";
import { requireProfile } from "@/lib/auth/server";
import { getRepo } from "@/lib/repo";
import { requestUploads } from "@/lib/services/uploads";
import { uploadRequestSchema } from "@/lib/validation/schemas";

export const POST = route(async (req) => {
  const user = await requireProfile();
  const input = await parseBody(req, uploadRequestSchema);
  const repo = await getRepo();
  return json(await requestUploads(repo, user.id, input));
});
