"use client";

import { createBrowserClient } from "@supabase/ssr";

/** ブラウザ用クライアント。Google ログインの開始（signInWithOAuth）にだけ使う。データ取得は必ず /api/v1 経由 */
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createBrowserClient(url, key);
}
