import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { serverConfig } from "@/lib/config";

/**
 * Cookie のセッションを使う Supabase クライアント（RLS 適用）。
 * Server Component / Route Handler から呼ぶ。Server Component では Cookie の書き込みが
 * できないため setAll は失敗を握りつぶす（セッション更新は src/proxy.ts が担当）。
 */
export async function createSupabaseServerClient() {
  const url = serverConfig.supabaseUrl;
  const key = serverConfig.supabaseAnonKey;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が設定されていません");
  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Component からの呼び出しでは書き込めない。proxy.ts がセッションを更新する
        }
      },
    },
  });
}
