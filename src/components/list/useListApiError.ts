"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { ApiClientError, errorMessage } from "@/lib/api/client";
import { loginUrl } from "@/lib/auth/next-path";
import { useToast } from "@/components/ui";

/** 現在の URL（パス＋クエリ＋ハッシュ）。SSR 中は "/" */
export function currentPath(): string {
  if (typeof window === "undefined") return "/";
  const { pathname, search, hash } = window.location;
  return `${pathname}${search}${hash}`;
}

/**
 * リスト系 API のエラー共通処理。
 * - 401：ログイン画面へ（戻り先付き）。戻り値 "unauthorized"
 * - 503（停止中）：呼び出し側で SuspendedNotice を出せるよう "suspended" を返す（トーストも出す）
 * - それ以外：エラートースト。戻り値 "error"
 */
export function useListApiError() {
  const router = useRouter();
  const toast = useToast();
  return useCallback(
    (err: unknown, fallback = "エラーが発生しました"): "unauthorized" | "suspended" | "error" => {
      if (err instanceof ApiClientError) {
        if (err.isUnauthorized) {
          router.push(loginUrl(currentPath()));
          return "unauthorized";
        }
        if (err.isSuspended) {
          toast.error(err.message || "現在この機能は利用できません");
          return "suspended";
        }
      }
      toast.error(errorMessage(err, fallback));
      return "error";
    },
    [router, toast],
  );
}
