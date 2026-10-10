"use client";

import {
  useCallback,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { IconButton } from "./IconButton";
import { useEscapeKey, useFocusTrap, useIsDesktop, useLockBodyScroll } from "./useLockBodyScroll";
import { cn } from "./cn";

export type SheetSnap = "peek" | "full";

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  /** 下部に固定するボタン列など */
  footer?: ReactNode;
  /** スマホでの高さ。省略時は内部で管理（初期 peek） */
  snap?: SheetSnap;
  onSnapChange?: (snap: SheetSnap) => void;
  initialSnap?: SheetSnap;
  /** PC（lg 以上）での見せ方：左パネル（幅 420px）か中央のダイアログか */
  desktop?: "panel" | "dialog";
  /** スマホで下部ナビの上に置く（地図ページ用）。false なら画面の最下部まで */
  aboveNav?: boolean;
  /** 閉じるボタンを出さない（戻る導線がページ側にある場合） */
  hideClose?: boolean;
  className?: string;
}

const DRAG_THRESHOLD = 60;

/**
 * スマホでは画面下からのシート（peek 約 40% / full）、PC では左側パネルまたはダイアログ。
 * ドラッグハンドル、閉じるボタン、Escape、背景スクロール固定に対応。
 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
  footer,
  snap: controlledSnap,
  onSnapChange,
  initialSnap = "peek",
  desktop = "panel",
  aboveNav = true,
  hideClose = false,
  className,
}: BottomSheetProps) {
  const titleId = useId();
  const isDesktop = useIsDesktop();
  const [innerSnap, setInnerSnap] = useState<SheetSnap>(initialSnap);
  const snap = controlledSnap ?? innerSnap;
  const setSnap = useCallback(
    (next: SheetSnap) => {
      if (controlledSnap === undefined) setInnerSnap(next);
      onSnapChange?.(next);
    },
    [controlledSnap, onSnapChange],
  );

  // 閉じたら次回は初期の高さに戻す
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (!open && controlledSnap === undefined && innerSnap !== initialSnap) setInnerSnap(initialSnap);
  }

  // 全画面またはダイアログのときだけ背景を固定する（peek のときは地図を触れる）
  const modal = open && (isDesktop ? desktop === "dialog" : snap === "full");
  useLockBodyScroll(modal);
  useEscapeKey(open, onClose);

  // モーダル（全画面・ダイアログ）のときだけフォーカスを閉じ込め、閉じたら元の要素へ戻す
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(open && modal, panelRef);

  // ドラッグハンドル：上に動かせば full、下に動かせば peek → 閉じる
  const dragStartY = useRef<number | null>(null);
  function onHandlePointerDown(e: ReactPointerEvent<HTMLButtonElement>) {
    dragStartY.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onHandlePointerUp(e: ReactPointerEvent<HTMLButtonElement>) {
    const start = dragStartY.current;
    dragStartY.current = null;
    if (start === null) return;
    const delta = e.clientY - start;
    if (delta < -DRAG_THRESHOLD) setSnap("full");
    else if (delta > DRAG_THRESHOLD) {
      if (snap === "full") setSnap("peek");
      else onClose();
    }
  }
  function toggleSnap() {
    setSnap(snap === "full" ? "peek" : "full");
  }

  if (!open) return null;

  const mobileHeight = snap === "full" ? "h-[calc(100dvh-var(--header-height))]" : "h-[40dvh]";
  const mobileBottom = aboveNav
    ? "bottom-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom))]"
    : "bottom-0";

  return (
    <>
      {modal ? (
        <div
          aria-hidden="true"
          onClick={onClose}
          className={cn(
            "fixed inset-0 z-40 bg-text/40",
            !isDesktop && aboveNav && "bottom-[var(--bottom-nav-height)]",
          )}
        />
      ) : null}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal={modal || undefined}
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cn(
          "fixed z-50 flex flex-col bg-surface text-text outline-none",
          // スマホ：下からのシート
          "inset-x-0 rounded-t-[var(--radius-card)] border-t border-border shadow-[var(--shadow-sheet)] transition-[height] duration-200",
          mobileBottom,
          mobileHeight,
          // PC
          desktop === "panel"
            ? "lg:inset-x-auto lg:left-0 lg:top-[var(--header-height)] lg:bottom-0 lg:h-auto lg:w-[420px] lg:rounded-none lg:border-t-0 lg:border-r lg:shadow-none"
            : "lg:inset-x-auto lg:left-1/2 lg:top-1/2 lg:bottom-auto lg:h-auto lg:max-h-[85dvh] lg:w-[560px] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-card lg:border",
          className,
        )}
      >
        <div className="flex items-center gap-2 px-4 pt-2 lg:pt-3">
          <button
            type="button"
            aria-label={snap === "full" ? "シートを小さくする" : "シートを大きくする"}
            onClick={toggleSnap}
            onPointerDown={onHandlePointerDown}
            onPointerUp={onHandlePointerUp}
            onPointerCancel={() => (dragStartY.current = null)}
            className="flex min-h-11 flex-1 touch-none items-center justify-center lg:hidden"
          >
            <span aria-hidden="true" className="h-1.5 w-10 rounded-full bg-border-strong" />
          </button>
          {title ? (
            <h2 id={titleId} className="hidden flex-1 truncate text-lg font-semibold lg:block">
              {title}
            </h2>
          ) : (
            <span className="hidden flex-1 lg:block" />
          )}
          {!hideClose ? <IconButton icon="x" aria-label="閉じる" onClick={onClose} /> : null}
        </div>
        {title ? (
          <h2
            id={`${titleId}-m`}
            className="truncate px-4 pb-2 text-lg font-semibold lg:hidden"
            aria-hidden="true"
          >
            {title}
          </h2>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">{children}</div>
        {footer ? <div className="border-t border-border bg-surface px-4 py-3">{footer}</div> : null}
      </div>
    </>
  );
}
