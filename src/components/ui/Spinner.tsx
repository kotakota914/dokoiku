import { Icon, type IconSize } from "./icons";
import { cn } from "./cn";

export interface SpinnerProps {
  size?: IconSize;
  label?: string;
  className?: string;
}

/** 回転する loader-circle。読み上げ用の文言を持つ */
export function Spinner({ size = 24, label = "読み込み中", className }: SpinnerProps) {
  return (
    <span role="status" aria-label={label} className={cn("inline-flex text-text-muted", className)}>
      <Icon name="loader-circle" size={size} />
    </span>
  );
}

export interface LoadingStateProps {
  message?: string;
  className?: string;
}

/** 中央にスピナー＋文言 */
export function LoadingState({ message = "読み込み中です", className }: LoadingStateProps) {
  return (
    <div
      role="status"
      className={cn(
        "flex min-h-40 flex-col items-center justify-center gap-3 p-6 text-text-muted",
        className,
      )}
    >
      <Icon name="loader-circle" size={24} />
      <p className="text-base">{message}</p>
    </div>
  );
}

export interface SkeletonProps {
  className?: string;
}

/** 読み込み中のプレースホルダー。大きさは className で指定する */
export function Skeleton({ className }: SkeletonProps) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-card bg-surface-muted", className)} />;
}
