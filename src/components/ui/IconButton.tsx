import type { ComponentPropsWithRef } from "react";
import { Icon, type IconName } from "./icons";
import { cn } from "./cn";

export type IconButtonVariant = "ghost" | "secondary" | "primary" | "danger";

const VARIANT: Record<IconButtonVariant, string> = {
  ghost: "bg-transparent text-text hover:bg-surface-muted",
  secondary: "border border-border bg-surface text-text hover:bg-surface-muted",
  primary: "bg-primary text-on-primary hover:bg-primary-strong",
  danger: "bg-transparent text-danger hover:bg-danger-soft",
};

export interface IconButtonProps extends Omit<ComponentPropsWithRef<"button">, "aria-label" | "children"> {
  /** アイコンだけのボタンなので必須（8.1） */
  "aria-label": string;
  icon: IconName;
  iconSize?: 16 | 20 | 24;
  variant?: IconButtonVariant;
  loading?: boolean;
}

/** アイコンのみのボタン。44×44px 以上のタップ領域 */
export function IconButton({
  icon,
  iconSize = 20,
  variant = "ghost",
  loading = false,
  disabled,
  className,
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      <Icon name={loading ? "loader-circle" : icon} size={iconSize} />
    </button>
  );
}
