import "server-only";
import { getDataBackend } from "@/lib/config";
import type { Repository } from "./types";

export type { Repository } from "./types";

/**
 * リクエストごとに Repository を取得する。
 * - memory  : プロセス内の単一インスタンス
 * - supabase: Cookie のセッションを持つクライアント（RLS 適用）＋ service role クライアント
 */
export async function getRepo(): Promise<Repository> {
  if (getDataBackend() === "supabase") {
    const mod = await import("./supabase");
    return mod.createSupabaseRepository();
  }
  const mod = await import("./memory");
  return mod.getMemoryRepository();
}
