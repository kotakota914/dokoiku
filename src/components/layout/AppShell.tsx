"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { ButtonLink } from "@/components/ui/Button";
import { Icon, type IconName } from "@/components/ui/icons";
import { cn } from "@/components/ui/cn";

export interface AppShellUser {
  displayName: string;
  avatarUrl: string | null;
}

export interface AppShellProps {
  /** ログイン中のユーザー。未ログインなら null（Server Component の layout から渡す） */
  user: AppShellUser | null;
  children: ReactNode;
  /** PC ヘッダー右側を差し替えたいとき（省略時は user からログイン／アバターを表示） */
  headerRight?: ReactNode;
}

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** 中央の大きな投稿ボタン */
  primary?: boolean;
  isActive: (pathname: string) => boolean;
}

const startsWith = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

const NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "マップ",
    icon: "map",
    isActive: (p) => p === "/" || startsWith(p, "/spots") || startsWith(p, "/search"),
  },
  {
    href: "/lists",
    label: "リスト",
    icon: "bookmark",
    isActive: (p) => startsWith(p, "/lists") || startsWith(p, "/plans"),
  },
  {
    href: "/posts/new",
    label: "投稿",
    icon: "camera",
    primary: true,
    isActive: (p) => startsWith(p, "/posts"),
  },
  {
    href: "/me",
    label: "マイページ",
    icon: "user",
    isActive: (p) => startsWith(p, "/me") || startsWith(p, "/welcome"),
  },
];

/**
 * 共通レイアウト。スマホは下部ナビ、PC（lg 以上）は上部ヘッダー。
 * main は flex-auto（内容の高さで伸びる）。flex-1（basis 0）だと body の min-h-full に収まる高さで
 * 固定され、内容がはみ出して下余白（下部ナビの逃げ）が効かなくなる。
 * 地図ページ（/）は自分で高さを決める（src/app/page.tsx）。
 */
export function AppShell({ user, children, headerRight }: AppShellProps) {
  const pathname = usePathname() ?? "/";

  return (
    <div className="flex min-h-full flex-1 flex-col">
      {/* PC ヘッダー */}
      <header className="sticky top-0 z-40 hidden h-[var(--header-height)] items-center gap-6 border-b border-border bg-surface px-6 lg:flex">
        <Link href="/" className="text-lg font-bold text-primary-strong">
          旅行どこいこう
        </Link>
        <nav aria-label="メインメニュー" className="flex flex-1 items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const active = item.isActive(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center gap-2 rounded-card px-3 text-base font-medium transition-colors",
                  active
                    ? "bg-primary-soft text-primary-strong"
                    : "text-text-muted hover:bg-surface-muted hover:text-text",
                )}
              >
                <Icon name={item.icon} size={20} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2">
          {headerRight !== undefined ? headerRight : <HeaderUser user={user} />}
        </div>
      </header>

      <main className="flex flex-auto flex-col pb-[calc(var(--bottom-nav-clearance)+env(safe-area-inset-bottom))] lg:pb-0">
        {children}
      </main>

      {/* スマホ下部ナビ */}
      <nav
        aria-label="メインメニュー"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <ul className="flex h-[var(--bottom-nav-height)] items-stretch">
          {NAV_ITEMS.map((item) => {
            const active = item.isActive(pathname);
            return (
              <li key={item.href} className="flex flex-1">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 w-full flex-col items-center justify-center gap-0.5 text-xs font-medium",
                    active ? "text-primary-strong" : "text-text-muted",
                  )}
                >
                  {item.primary ? (
                    <span
                      className={cn(
                        "-mt-5 flex size-14 items-center justify-center rounded-full border-4 border-surface shadow-[var(--shadow-sheet)]",
                        active ? "bg-primary-strong text-on-primary" : "bg-primary text-on-primary",
                      )}
                    >
                      <Icon name={item.icon} size={24} />
                    </span>
                  ) : (
                    <Icon name={item.icon} size={24} />
                  )}
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

/** PC ヘッダー右側：ログインボタン or アバター（マイページへ） */
function HeaderUser({ user }: { user: AppShellUser | null }) {
  if (!user) {
    return (
      <ButtonLink href="/login" variant="secondary" leftIcon="log-in">
        ログイン
      </ButtonLink>
    );
  }
  return (
    <Link
      href="/me"
      className="inline-flex min-h-11 items-center gap-2 rounded-card px-2 text-base text-text hover:bg-surface-muted"
    >
      <Avatar src={user.avatarUrl} name={user.displayName} size={32} />
      <span className="max-w-40 truncate">{user.displayName}</span>
    </Link>
  );
}
