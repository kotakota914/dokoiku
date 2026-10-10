import Link from "next/link";
import type { ComponentPropsWithRef, ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "lg";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-card font-medium transition-colors select-none " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary " +
  "disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-strong",
  secondary: "border border-border bg-surface text-text hover:bg-surface-muted",
  ghost: "bg-transparent text-text hover:bg-surface-muted",
  danger: "bg-danger text-on-primary hover:opacity-90",
};

/** タップ領域 44px 以上（8.1） */
const SIZE: Record<ButtonSize, string> = {
  md: "min-h-11 px-4 text-base",
  lg: "min-h-12 px-6 text-lg",
};

export interface ButtonStyleProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leftIcon?: IconName;
  fullWidth?: boolean;
}

export function buttonClassName(
  { variant = "primary", size = "md", fullWidth }: ButtonStyleProps,
  className?: string,
) {
  return cn(BASE, VARIANT[variant], SIZE[size], fullWidth && "w-full", className);
}

export interface ButtonProps extends ButtonStyleProps, ComponentPropsWithRef<"button"> {
  /** 処理中：スピナーを表示して押せなくする */
  loading?: boolean;
}

export function Button({
  variant,
  size,
  leftIcon,
  fullWidth,
  loading = false,
  disabled,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={buttonClassName({ variant, size, fullWidth }, className)}
      {...rest}
    >
      {loading ? (
        <Icon name="loader-circle" size={20} />
      ) : leftIcon ? (
        <Icon name={leftIcon} size={20} />
      ) : null}
      {children}
    </button>
  );
}

export interface ButtonLinkProps
  extends ButtonStyleProps, Omit<ComponentPropsWithRef<typeof Link>, "className"> {
  className?: string;
  children?: ReactNode;
}

/** リンクをボタンの見た目で表示する（next/link） */
export function ButtonLink({
  variant,
  size,
  leftIcon,
  fullWidth,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link className={buttonClassName({ variant, size, fullWidth }, className)} {...rest}>
      {leftIcon ? <Icon name={leftIcon} size={20} /> : null}
      {children}
    </Link>
  );
}
