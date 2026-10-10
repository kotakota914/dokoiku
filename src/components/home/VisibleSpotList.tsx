"use client";

/**
 * PC（lg 以上）の左パネル：表示範囲内のスポット一覧。
 * クリックで地図のピンを強調し、パネル内に SpotPeekCard を出す（MapHome が切り替える）。
 */
import { useMemo } from "react";
import {
  Button,
  ButtonLink,
  EmptyState,
  Icon,
  LoadingState,
  PhotoImage,
  PopularityBadge,
  SuspendedNotice,
  cn,
} from "@/components/ui";
import type { SpotSummary, SpotsInViewResponse } from "@/lib/domain/types";

export interface VisibleSpotListProps {
  data: SpotsInViewResponse | null;
  spots: SpotSummary[];
  loading: boolean;
  selectedSpotId: string | null;
  onSelect: (spot: SpotSummary) => void;
  postCreateSuspended?: boolean;
  className?: string;
}

export function VisibleSpotList({
  data,
  spots,
  loading,
  selectedSpotId,
  onSelect,
  postCreateSuspended = false,
  className,
}: VisibleSpotListProps) {
  const sorted = useMemo(() => [...spots].sort((a, b) => b.postCount - a.postCount), [spots]);

  let body: React.ReactNode;
  if (data === null) {
    body = loading ? (
      <LoadingState message="スポットを読み込んでいます" />
    ) : (
      <EmptyState icon="map" title="地図を動かすとスポットが表示されます" />
    );
  } else if (data.mode === "heatmap") {
    body = (
      <EmptyState
        icon="map"
        title="地図を拡大するとスポットが表示されます"
        description={
          data.points.length === 0
            ? "このエリアにはまだ投稿がありません"
            : "広い範囲では投稿の多さをヒートマップで表示しています"
        }
      />
    );
  } else if (sorted.length === 0) {
    body = (
      <EmptyState
        icon="camera"
        title="このエリアにはまだ投稿がありません"
        description={postCreateSuspended ? <SuspendedNotice feature="post_create" /> : undefined}
        action={
          postCreateSuspended ? (
            <Button leftIcon="camera" disabled>
              投稿する
            </Button>
          ) : (
            <ButtonLink href="/posts/new" leftIcon="camera">
              投稿する
            </ButtonLink>
          )
        }
      />
    );
  } else {
    body = (
      <ul className="flex flex-col gap-2 p-3">
        {sorted.map((spot) => {
          const selected = spot.id === selectedSpotId;
          return (
            <li key={spot.id}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(spot)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-card border p-2 text-left transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                  selected
                    ? "border-primary bg-primary-soft"
                    : "border-border bg-surface hover:bg-surface-muted",
                )}
              >
                <PhotoImage
                  src={spot.coverThumbUrl}
                  alt={`${spot.name}の代表写真`}
                  category={spot.category}
                  className="size-14 shrink-0 rounded-card border border-border"
                  fallbackIconSize={20}
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-base font-semibold text-text">{spot.name}</span>
                  <span className="flex flex-wrap items-center gap-2 text-base text-text-muted">
                    <span className="inline-flex items-center gap-1">
                      <Icon name="camera" size={16} />
                      投稿 {spot.postCount}件
                    </span>
                    <PopularityBadge popularity={spot.popularity} />
                  </span>
                </span>
                <Icon name="chevron-right" size={20} className="text-text-muted" />
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div className="flex min-h-11 items-center justify-between gap-2 border-b border-border px-4 py-2">
        <h2 className="text-lg font-semibold text-text">表示範囲のスポット</h2>
        {data?.mode === "spots" ? <span className="text-base text-text-muted">{spots.length}件</span> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
    </div>
  );
}
