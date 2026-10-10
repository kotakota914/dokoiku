"use client";

import { useState, type ComponentPropsWithRef } from "react";
import type { Category } from "@/lib/domain/constants";
import { CategoryIcon } from "./icons";
import { cn } from "./cn";

export interface PhotoImageProps extends Omit<ComponentPropsWithRef<"img">, "src" | "alt" | "onError"> {
  src: string | null | undefined;
  alt: string;
  /** 読み込み失敗時に代替表示するカテゴリ（F-1 例外） */
  category: Category;
  /** 代替表示のアイコンサイズ */
  fallbackIconSize?: 16 | 20 | 24;
  /** 外枠（代替表示の枠にも適用） */
  className?: string;
}

/** 写真の <img>。src が無い／読み込み失敗ならカテゴリのアイコンに切り替える */
export function PhotoImage({
  src,
  alt,
  category,
  fallbackIconSize = 24,
  className,
  loading = "lazy",
  ...rest
}: PhotoImageProps) {
  const [failed, setFailed] = useState(false);
  // src が差し替わったら再挑戦する
  const [prevSrc, setPrevSrc] = useState(src);
  if (prevSrc !== src) {
    setPrevSrc(src);
    setFailed(false);
  }

  if (!src || failed) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={cn("flex items-center justify-center bg-surface-muted text-text-muted", className)}
      >
        <CategoryIcon category={category} size={fallbackIconSize} />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading={loading}
      decoding="async"
      onError={() => setFailed(true)}
      className={cn("object-cover", className)}
      {...rest}
    />
  );
}
