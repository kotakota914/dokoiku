"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { IconButton } from "./IconButton";
import { cn } from "./cn";

export type ToastType = "success" | "error" | "info";

export interface ToastOptions {
  type?: ToastType;
  message: string;
  /** 自動で消えるまでの時間（ms）。0 なら手動で閉じるまで残す */
  durationMs?: number;
}

interface ToastItem extends Required<ToastOptions> {
  id: number;
}

export interface ToastApi {
  show: (options: ToastOptions) => number;
  success: (message: string) => number;
  error: (message: string) => number;
  info: (message: string) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_DURATION: Record<ToastType, number> = { success: 4000, info: 4000, error: 6000 };
const ICON: Record<ToastType, IconName> = { success: "check", error: "circle-alert", info: "info" };
const STYLE: Record<ToastType, string> = {
  success: "bg-success-soft text-success",
  error: "bg-danger-soft text-danger",
  info: "bg-primary-soft text-primary-strong",
};

/** トースト通知。layout で全体を包む */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setItems((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const show = useCallback(
    ({ type = "info", message, durationMs }: ToastOptions) => {
      const id = ++seq.current;
      const duration = durationMs ?? DEFAULT_DURATION[type];
      setItems((prev) => [...prev.slice(-2), { id, type, message, durationMs: duration }]);
      if (duration > 0)
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      return id;
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (message) => show({ type: "success", message }),
      error: (message) => show({ type: "error", message }),
      info: (message) => show({ type: "info", message }),
      dismiss,
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 top-[max(1rem,env(safe-area-inset-top))] z-[60] flex flex-col items-center gap-2 px-4"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.type === "error" ? "alert" : "status"}
            className={cn(
              "pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-card border border-border py-2 pl-4 pr-1 shadow-[var(--shadow-sheet)]",
              STYLE[t.type],
            )}
          >
            <Icon name={ICON[t.type]} size={20} />
            <p className="flex-1 text-base text-text">{t.message}</p>
            <IconButton
              icon="x"
              aria-label="閉じる"
              onClick={() => dismiss(t.id)}
              className="text-text-muted"
            />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast は ToastProvider の内側で使ってください");
  return ctx;
}
