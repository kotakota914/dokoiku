"use client";

import { useState } from "react";
import { Icon } from "./icons";
import { cn } from "./cn";

export type AvatarSize = 32 | 40 | 64;

export interface AvatarProps {
  src: string | null | undefined;
  /** 表示名（alt に使う） */
  name: string;
  size?: AvatarSize;
  className?: string;
}

const ICON_SIZE: Record<AvatarSize, 16 | 20 | 24> = { 32: 16, 40: 20, 64: 24 };

/** ユーザーのアイコン画像。無い・読めないときは user アイコン */
export function Avatar({ src, name, size = 40, className }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };
  if (!src || failed) {
    return (
      <span
        role="img"
        aria-label={name}
        style={style}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full border border-border bg-surface-muted text-text-muted",
          className,
        )}
      >
        <Icon name="user" size={ICON_SIZE[size]} />
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={name}
      width={size}
      height={size}
      style={style}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={cn("shrink-0 rounded-full border border-border object-cover", className)}
    />
  );
}
