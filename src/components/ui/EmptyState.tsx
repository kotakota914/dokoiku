import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { cn } from "./cn";

export interface EmptyStateProps {
  icon?: IconName;
  title: ReactNode;
  description?: ReactNode;
  /** Button や ButtonLink を渡す */
  action?: ReactNode;
  className?: string;
}

/** データが無いときの表示：アイコン＋見出し＋説明＋任意のアクション */
export function EmptyState({ icon = "info", title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-10 text-center", className)}>
      <span className="flex size-14 items-center justify-center rounded-full bg-surface-muted text-text-muted">
        <Icon name={icon} size={24} />
      </span>
      <h2 className="text-lg font-semibold text-text">{title}</h2>
      {description ? <p className="max-w-md text-base text-text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
