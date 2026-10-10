/**
 * POST /api/v1/me/profile { displayName }
 * 初回ログイン時のプロフィール作成（F-6-2）。既にあれば表示名だけ更新する。
 * 作成時は 201、更新時は 200 で Profile を返す。
 */
import { z } from "zod";
import { created, json, parseBody, route } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/server";
import { getRepo } from "@/lib/repo";
import { displayNameSchema } from "@/lib/validation/schemas";

export const createProfileSchema = z.object({ displayName: displayNameSchema });

export const POST = route(async (req) => {
  const user = await requireUser();
  const { displayName } = await parseBody(req, createProfileSchema);
  const repo = await getRepo();
  if (user.profile) {
    const profile = await repo.profiles.update(user.id, { displayName });
    return json(profile);
  }
  const profile = await repo.profiles.create({
    id: user.id,
    displayName,
    avatarUrl: user.suggestedAvatarUrl,
  });
  return created(profile);
});
