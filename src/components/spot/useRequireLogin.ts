"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

/** 未ログイン時に遷移するログイン URL（戻り先付き） */
export function loginHref(next: string): string {
  return `/login?next=${encodeURIComponent(next)}`;
}

/**
 * 現在の URL（パス＋クエリ＋ハッシュ）を next にしてログイン画面へ移動する関数を返す。
 * useSearchParams は Suspense 境界を要求するため、押された時点の window.location を読む。
 */
export function useRequireLogin() {
  const router = useRouter();
  return useCallback(() => {
    const loc = typeof window !== "undefined" ? window.location : null;
    const current = loc ? `${loc.pathname}${loc.search}${loc.hash}` : "/";
    router.push(loginHref(current));
  }, [router]);
}
