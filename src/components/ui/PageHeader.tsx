"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Icon } from "./icons";
import { IconButton } from "./IconButton";
import { cn } from "./cn";

export interface PageHeaderProps {
  title: ReactNode;
  /** 戻る先。指定が無ければ履歴を戻る */
  backHref?: string;
  onBack?: () => void;
  hideBack?: boolean;
  /** 右側のアクション（IconButton など） */
  actions?: ReactNode;
  /** 画面上部に固定する（既定 true） */
  sticky?: boolean;
  className?: string;
}

/** 画面上部の見出し：戻る（chevron-left）＋タイトル＋右側のアクション */
export function PageHeader({
  title,
  backHref,
  onBack,
  hideBack = false,
  actions,
  sticky = true,
  className,
}: PageHeaderProps) {
  const router = useRouter();
  const back = (
    <>
      {hideBack ? null : backHref ? (
        <Link
          href={backHref}
          aria-label="戻る"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-text hover:bg-surface-muted"
        >
          <Icon name="chevron-left" size={24} />
        </Link>
      ) : (
        <IconButton
          icon="chevron-left"
          iconSize={24}
          aria-label="戻る"
          onClick={onBack ?? (() => router.back())}
        />
      )}
    </>
  );
  return (
    <header
      className={cn(
        "z-30 flex min-h-[var(--header-height)] items-center gap-1 border-b border-border bg-surface px-2",
        sticky && "sticky top-0",
        className,
      )}
    >
      {back}
      <h1 className={cn("min-w-0 flex-1 truncate text-lg font-semibold text-text", hideBack && "pl-2")}>
        {title}
      </h1>
      {actions ? <div className="flex items-center gap-1">{actions}</div> : null}
    </header>
  );
}
