import type { ComponentPropsWithRef, ElementType } from "react";
import { cn } from "./cn";

export type Tone = "default" | "muted" | "danger" | "warning" | "success" | "primary";

/** 8.2：四辺 1px の淡い枠線、または淡い背景色で状態を表す。片側だけの色帯は使わない */
export const TONE_SURFACE: Record<Tone, string> = {
  default: "bg-surface border-border text-text",
  muted: "bg-surface-muted border-border text-text",
  danger: "bg-danger-soft border-border text-text",
  warning: "bg-warning-soft border-border text-text",
  success: "bg-success-soft border-border text-text",
  primary: "bg-primary-soft border-border text-text",
};

export interface CardProps extends ComponentPropsWithRef<"div"> {
  tone?: Tone;
  /** 内側の余白を無くす（写真を端まで出すときなど） */
  flush?: boolean;
  /** セマンティクスを変えたいとき（section, article, li など） */
  as?: ElementType;
}

/** 角丸 12px・四辺 1px 枠・ごく薄い影のカード */
export function Card({ tone = "default", flush = false, as, className, children, ...rest }: CardProps) {
  const Component = (as ?? "div") as ElementType;
  return (
    <Component
      className={cn(
        "rounded-card border shadow-[var(--shadow-card)]",
        TONE_SURFACE[tone],
        !flush && "p-4",
        className,
      )}
      {...rest}
    >
      {children}
    </Component>
  );
}
