"use client";

import { useEffect, useSyncExternalStore, type RefObject } from "react";

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

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.closest('[aria-hidden="true"], [hidden]'),
  );
}

/**
 * モーダル（role=dialog aria-modal）のフォーカス管理。
 * - 有効になったらパネルへフォーカスを移し、Tab / Shift+Tab はパネル内の先頭・末尾で循環させる
 * - 無効になった（閉じた）とき、開く前にフォーカスがあった要素へ戻す
 * フォーカス可能な要素が無ければ Tab でパネル自体に留める
 */
export function useFocusTrap(active: boolean, panelRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active) return;
    const panel = panelRef.current;
    if (!panel) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key !== "Tab" || !panel) return;
      const items = focusableIn(panel);
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      // パネル自体（開いた直後）か外側にいるときは、Tab で先頭・Shift+Tab で末尾へ
      const inside = current instanceof HTMLElement && current !== panel && panel.contains(current);
      if (e.shiftKey) {
        if (!inside || current === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (!inside || current === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (previous && previous.isConnected) previous.focus();
    };
  }, [active, panelRef]);
}
