"use client";

import { useEffect, useSyncExternalStore } from "react";

let lockCount = 0;
let previousOverflow = "";

/** モーダル表示中に背景のスクロールを止める（重なった場合は最後の解除まで保持） */
export function useLockBodyScroll(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    if (lockCount === 0) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    lockCount += 1;
    return () => {
      lockCount -= 1;
      if (lockCount === 0) document.body.style.overflow = previousOverflow;
    };
  }, [locked]);
}

/** Escape キーで閉じる */
export function useEscapeKey(enabled: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!enabled) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onEscape();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled, onEscape]);
}

/** lg（1024px）以上かどうか。SSR 時は false */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 1024px)");
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (callback) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", callback);
      return () => mql.removeEventListener("change", callback);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
