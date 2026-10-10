/**
 * GET /api/dev/users
 * memory モード専用。開発用ログインに使えるユーザーの一覧（id, displayName, isAdmin）。
 */
import { getDataBackend } from "@/lib/config";
import { ApiError } from "@/lib/api/errors";
import { json, route } from "@/lib/api/handler";
import { getMemoryRepository, SEED_USER_ID_LIST } from "@/lib/repo/memory";

export const GET = route(async () => {
  if (getDataBackend() !== "memory") throw ApiError.notFound();
  const repo = getMemoryRepository();
  const users: { id: string; displayName: string; isAdmin: boolean }[] = [];
  for (const id of SEED_USER_ID_LIST) {
    const p = await repo.profiles.getById(id);
    if (p) users.push({ id: p.id, displayName: p.displayName, isAdmin: p.isAdmin });
  }
  return json({ users });
});
