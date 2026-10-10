import "server-only";
import { cookies } from "next/headers";
import { getDataBackend } from "@/lib/config";
import { ApiError } from "@/lib/api/errors";
import { getRepo } from "@/lib/repo";
import type { Profile } from "@/lib/domain/types";

/** memory モードの開発用ログインで使う Cookie 名 */
export const DEV_USER_COOKIE = "dokoiko_dev_user";

export interface CurrentUser {
  id: string;
  email: string | null;
  /** 初回ログイン直後（/welcome 前）は null になりうる */
  profile: Profile | null;
  isAdmin: boolean;
  /** Google アカウントの名前（初回プロフィール設定の初期値） */
  suggestedDisplayName: string;
  suggestedAvatarUrl: string | null;
}

/** ログイン中のユーザー。未ログインなら null。Server Component / Route Handler から呼ぶ */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const repo = await getRepo();
  if (getDataBackend() === "supabase") {
    const { createSupabaseServerClient } = await import("@/lib/supabase/server");
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    const u = data.user;
    const profile = await repo.profiles.getById(u.id);
    const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
    return {
      id: u.id,
      email: u.email ?? null,
      profile,
      isAdmin: profile?.isAdmin ?? false,
      suggestedDisplayName: String(meta.full_name ?? meta.name ?? u.email?.split("@")[0] ?? "ユーザー").slice(0, 20),
      suggestedAvatarUrl: typeof meta.avatar_url === "string" ? meta.avatar_url : typeof meta.picture === "string" ? meta.picture : null,
    };
  }
  const store = await cookies();
  const id = store.get(DEV_USER_COOKIE)?.value;
  if (!id) return null;
  const profile = await repo.profiles.getById(id);
  if (!profile) return null;
  return {
    id,
    email: `${id}@example.com`,
    profile,
    isAdmin: profile.isAdmin,
    suggestedDisplayName: profile.displayName,
    suggestedAvatarUrl: profile.avatarUrl,
  };
}

/** ログイン必須の API で使う。未ログインなら 401 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw ApiError.unauthorized();
  return user;
}

/** 管理者専用 API で使う */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!user.isAdmin) throw ApiError.forbidden();
  return user;
}
