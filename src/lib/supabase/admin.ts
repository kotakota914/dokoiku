import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverConfig } from "@/lib/config";

/** service role クライアント（RLS を通らない）。api_usage・通報・退会・一時ファイル削除など、サーバーだけが行う処理に限定して使う */
export function createSupabaseAdminClient() {
  const url = serverConfig.supabaseUrl;
  const key = serverConfig.supabaseServiceRoleKey;
  if (!url || !key)
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が設定されていません");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
