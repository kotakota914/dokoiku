import "server-only";
import { cookies } from "next/headers";
import { getDataBackend } from "@/lib/config";
import { DEV_USER_COOKIE } from "@/lib/auth/server";

/**
 * ログアウト・退会で使う。Route Handler から呼ぶ（Server Component では Cookie を書けない）。
 * - supabase：ローカルのセッション Cookie を破棄する（退会後は auth ユーザーが無いので scope は local）
 * - memory  ：開発用ログインの Cookie を削除する
 */
export async function clearSession(): Promise<void> {
  if (getDataBackend() === "supabase") {
    const { createSupabaseServerClient } = await import("@/lib/supabase/server");
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut({ scope: "local" });
    return;
  }
  const store = await cookies();
  store.set({ name: DEV_USER_COOKIE, value: "", httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
}
