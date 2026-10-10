"use client";

/**
 * リスト内のスポット 1 行（S-07 / S-10）。
 * - 「必ず行きたい」トグル（star、aria-pressed）：PATCH /lists/{id}/items/{spotId} { mustVisit }（F-4-4）
 * - 削除（trash-2）：DELETE /lists/{id}/items/{spotId}
 * - 削除済みスポット（spot が null）は「このスポットは削除されました」バッジ付きで表示し、経路作成の対象外である旨を出す（F-4 例外）
 * - readOnly（共有リスト）では操作ボタンを出さない
 */
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api/client";
import type { WishlistItem } from "@/lib/domain/types";
import {
  Badge,
  CategoryLabel,
  Icon,
  IconButton,
  PhotoImage,
  PopularityBadge,
  cn,
  useToast,
} from "@/components/ui";
import { useListApiError } from "./useListApiError";

export interface ListItemRowProps {
  listId: string;
  item: WishlistItem;
  /** 共有リストなど閲覧のみ */
  readOnly?: boolean;
  onMustVisitChange?: (spotId: string, mustVisit: boolean) => void;
  onRemoved?: (spotId: string) => void;
  className?: string;
}

export function spotHref(spotId: string): string {
  return `/spots/${encodeURIComponent(spotId)}`;
}

export function ListItemRow({
  listId,
  item,
  readOnly = false,
  onMustVisitChange,
  onRemoved,
  className,
}: ListItemRowProps) {
  const toast = useToast();
  const handleError = useListApiError();
  const [mustVisit, setMustVisit] = useState(item.mustVisit);
  const [toggling, setToggling] = useState(false);
  const [removing, setRemoving] = useState(false);
  const spot = item.spot;

  async function toggleMustVisit() {
    const next = !mustVisit;
    setMustVisit(next);
    setToggling(true);
    try {
      await api.patch(`/lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(item.spotId)}`, {
        mustVisit: next,
      });
      onMustVisitChange?.(item.spotId, next);
    } catch (err) {
      setMustVisit(!next);
      handleError(err, "必ず行きたいを変更できませんでした");
    } finally {
      setToggling(false);
    }
  }

  async function remove() {
    setRemoving(true);
    try {
      await api.delete(`/lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(item.spotId)}`);
      toast.success("リストから削除しました");
      onRemoved?.(item.spotId);
    } catch (err) {
      handleError(err, "削除できませんでした");
      setRemoving(false);
    }
  }

  const name = spot?.name ?? "削除されたスポット";
  const thumb = (
    <PhotoImage
      src={spot?.coverThumbUrl ?? null}
      alt={`${name}の代表写真`}
      category={spot?.category ?? "other"}
      className="size-16 shrink-0 rounded-card border border-border"
      fallbackIconSize={20}
    />
  );

  return (
    <li
      className={cn(
        "flex items-center gap-3 rounded-card border border-border p-2",
        spot ? "bg-surface" : "bg-surface-muted",
        className,
      )}
    >
      {spot ? (
        <Link
          href={spotHref(spot.id)}
          className="shrink-0 rounded-card focus-visible:outline-2 focus-visible:outline-primary"
        >
          {thumb}
        </Link>
      ) : (
        thumb
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {spot ? (
          <Link
            href={spotHref(spot.id)}
            className="truncate text-base font-semibold text-text hover:underline"
          >
            {spot.name}
          </Link>
        ) : (
          <p className="truncate text-base font-semibold text-text-muted">{name}</p>
        )}
        {spot ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-base text-text-muted">
            <CategoryLabel category={spot.category} />
            <span className="inline-flex items-center gap-1">
              <Icon name="camera" size={16} />
              投稿 {spot.postCount}件
            </span>
            <PopularityBadge popularity={spot.popularity} />
            {mustVisit ? (
              <Badge icon="star" tone="warning">
                必ず行きたい
              </Badge>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <Badge icon="triangle-alert" tone="muted">
              このスポットは削除されました
            </Badge>
            <p className="text-base text-text-muted">経路作成の対象になりません</p>
          </div>
        )}
      </div>
      {!readOnly ? (
        <div className="flex shrink-0 items-center">
          {spot ? (
            <IconButton
              icon="star"
              aria-label="必ず行きたい"
              aria-pressed={mustVisit}
              onClick={() => void toggleMustVisit()}
              loading={toggling}
              className={cn(mustVisit && "text-warning")}
            />
          ) : null}
          <IconButton
            icon="trash-2"
            aria-label={`${name}をリストから削除`}
            variant="danger"
            onClick={() => void remove()}
            loading={removing}
          />
        </div>
      ) : null}
    </li>
  );
}
