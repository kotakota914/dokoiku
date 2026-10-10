/**
 * GET    /api/v1/me  自分のユーザー情報とプロフィール
 * PATCH  /api/v1/me  表示名・アイコン URL の変更（F-6-3）
 * DELETE /api/v1/me  退会（F-6-4）：投稿・いいね・リスト・プラン・通報・写真・プロフィールを削除してセッションを消す
 */
import { json, noContent, parseBody, route } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/server";
import { clearSession } from "@/lib/auth/session";
import { getRepo } from "@/lib/repo";
import { updateProfileSchema } from "@/lib/validation/schemas";
import type { MeResponse } from "@/lib/auth/me-types";

export const GET = route(async () => {
  const user = await requireUser();
  const body: MeResponse = {
    user: { id: user.id, email: user.email, isAdmin: user.isAdmin },
    profile: user.profile,
  };
  return json(body);
});

export const PATCH = route(async (req) => {
  const user = await requireUser();
  const patch = await parseBody(req, updateProfileSchema);
  if (!user.profile)
    throw ApiError.notFound("プロフィールが作成されていません。先に表示名を設定してください");
  const repo = await getRepo();
  const profile = await repo.profiles.update(user.id, patch);
  return json(profile);
});

export const DELETE = route(async () => {
  const user = await requireUser();
  const repo = await getRepo();
  // supabase 実装は deleteAccount の中で auth ユーザーも削除する（src/lib/repo/supabase）。API 側では呼ばない
  const { deletedImagePaths } = await repo.profiles.deleteAccount(user.id);
  if (deletedImagePaths.length > 0) {
    try {
      await repo.storage.deleteObjects(deletedImagePaths);
    } catch (err) {
      // 写真の削除失敗で退会を失敗にしない（残った一時ファイルは定期処理で扱う）
      console.error("[me.delete] 写真の削除に失敗しました", err instanceof Error ? err.message : err);
    }
  }
  await clearSession();
  return noContent();
});
