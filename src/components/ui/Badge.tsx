import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import type { Tone } from "./Card";
import { cn } from "./cn";

const TONE: Record<Tone, string> = {
  default: "bg-surface border-border text-text",
  muted: "bg-surface-muted border-border text-text-muted",
  danger: "bg-danger-soft border-border text-danger",
  warning: "bg-warning-soft border-border text-warning",
  success: "bg-success-soft border-border text-success",
  primary: "bg-primary-soft border-border text-primary-strong",
};

export interface BadgeProps {
  icon?: IconName;
  tone?: Tone;
  children: ReactNode;
  className?: string;
}

/** 状態・種類をアイコン＋文字で表すバッジ（8.2）。色だけに頼らない */
export function Badge({ icon, tone = "default", children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-base font-medium leading-6",
        TONE[tone],
        className,
      )}
    >
      {icon ? <Icon name={icon} size={16} /> : null}
      <span>{children}</span>
    </span>
  );
}
