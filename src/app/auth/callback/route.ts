/**
 * GET /auth/callback?code=&next=
 * Supabase（Google）の OAuth コールバック。code をセッションに交換し、
 * プロフィール未作成なら /welcome（F-6-2）、あれば next へ戻す。失敗時は /login?error=oauth。
 * route() は使わない（redirect の例外を 500 に変換してしまうため NextResponse.redirect で返す）。
 */
import { NextResponse, type NextRequest } from "next/server";
import { getDataBackend } from "@/lib/config";
import { getRepo } from "@/lib/repo";
import { safeNext, welcomeUrl } from "@/lib/auth/next-path";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  const to = (path: string) => NextResponse.redirect(new URL(path, req.url));

  if (getDataBackend() !== "supabase" || !code) return to("/login?error=oauth");

  try {
    const { createSupabaseServerClient } = await import("@/lib/supabase/server");
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data.user) {
      console.error("[auth/callback] exchangeCodeForSession に失敗しました", error?.message);
      return to("/login?error=oauth");
    }
    const repo = await getRepo();
    const profile = await repo.profiles.getById(data.user.id);
    return to(profile ? next : welcomeUrl(next));
  } catch (err) {
    console.error("[auth/callback] 失敗しました", err instanceof Error ? err.message : err);
    return to("/login?error=oauth");
  }
}
