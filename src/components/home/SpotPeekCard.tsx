"use client";

/**
 * 写真ピンをタップしたときに出すスポットの要約（F-1-6）。
 * スマホのボトムシートと PC の左パネルで共通に使う。
 */
import {
  Button,
  ButtonLink,
  CategoryLabel,
  Icon,
  PhotoImage,
  PopularityBadge,
  SuspendedNotice,
  cn,
} from "@/components/ui";
import type { SpotSummary } from "@/lib/domain/types";

export interface SpotPeekCardProps {
  spot: SpotSummary;
  /** 「行きたい場所リストに追加」を押したとき（リスト選択を開く） */
  onAddToList: () => void;
  /** F-8-5：投稿（アップロード）が停止中なら投稿ボタンを無効化する */
  postCreateSuspended?: boolean;
  /** シートの title で名前を出しているときは本文の見出しを省く */
  hideName?: boolean;
  className?: string;
}

export function spotDetailHref(spotId: string): string {
  return `/spots/${encodeURIComponent(spotId)}`;
}

export function newPostHref(spotId: string): string {
  return `/posts/new?spotId=${encodeURIComponent(spotId)}`;
}

export function SpotPeekCard({
  spot,
  onAddToList,
  postCreateSuspended = false,
  hideName = false,
  className,
}: SpotPeekCardProps) {
  const area = [spot.prefecture, spot.city].filter(Boolean).join(" ");
  return (
    <section aria-label={spot.name} className={cn("flex flex-col gap-4", className)}>
      <div className="flex gap-3">
        <PhotoImage
          src={spot.coverThumbUrl}
          alt={`${spot.name}の代表写真`}
          category={spot.category}
          className="size-20 shrink-0 rounded-card border border-border"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {hideName ? null : <h3 className="truncate text-lg font-semibold text-text">{spot.name}</h3>}
          <p className="flex items-center gap-1 text-base text-text-muted">
            <Icon name="camera" size={16} />
            <span>投稿 {spot.postCount}件</span>
          </p>
          <div className="flex flex-wrap items-center gap-2 text-base text-text-muted">
            <CategoryLabel category={spot.category} />
            <PopularityBadge popularity={spot.popularity} />
          </div>
          {area ? <p className="truncate text-base text-text-muted">{area}</p> : null}
        </div>
      </div>

      {postCreateSuspended ? <SuspendedNotice feature="post_create" /> : null}

      <div className="flex flex-col gap-2">
        <ButtonLink href={spotDetailHref(spot.id)} variant="primary" fullWidth>
          詳細を見る
        </ButtonLink>
        <Button variant="secondary" leftIcon="bookmark-plus" fullWidth onClick={onAddToList}>
          行きたい場所リストに追加
        </Button>
        {postCreateSuspended ? (
          <Button variant="secondary" leftIcon="camera" fullWidth disabled>
            このスポットに投稿
          </Button>
        ) : (
          <ButtonLink href={newPostHref(spot.id)} variant="secondary" leftIcon="camera" fullWidth>
            このスポットに投稿
          </ButtonLink>
        )}
      </div>
    </section>
  );
}
