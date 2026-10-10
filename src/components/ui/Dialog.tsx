"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { useEscapeKey, useLockBodyScroll } from "./useLockBodyScroll";
import { cn } from "./cn";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** ボタン列 */
  footer?: ReactNode;
  className?: string;
}

/** 中央のモーダル。Escape・背景クリックで閉じる */
export function Dialog({ open, onClose, title, description, children, footer, className }: DialogProps) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useLockBodyScroll(open);
  useEscapeKey(open, onClose);
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <div aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-text/40" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          "relative flex w-full max-w-md flex-col gap-4 rounded-card border border-border bg-surface p-5 text-text shadow-[var(--shadow-sheet)] outline-none",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <IconButton icon="x" aria-label="閉じる" onClick={onClose} className="-mr-2 -mt-2" />
        </div>
        {description ? (
          <p id={descId} className="text-base text-text-muted">
            {description}
          </p>
        ) : null}
        {children}
        {footer ? (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 削除などの取り消せない操作は true（確定ボタンが danger になる） */
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** 「本当に削除しますか」などの確認ダイアログ */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "OK",
  cancelLabel = "キャンセル",
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={loading ? () => undefined : onCancel}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            onClick={onConfirm}
            loading={loading}
            leftIcon={danger ? "trash-2" : undefined}
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
