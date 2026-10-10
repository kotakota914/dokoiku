"use client";

/**
 * S-10 共有リスト（F-4-6）。ログイン不要・閲覧のみ。名前、所有者、スポット一覧、地図。
 */
import type { SharedWishlist } from "@/lib/domain/types";
import { Badge, EmptyState, Icon, PageHeader } from "@/components/ui";
import { ListItemRow } from "./ListItemRow";
import { ListSpotMap } from "./ListSpotMap";

export interface SharedListViewProps {
  token: string;
  list: SharedWishlist;
}

export function SharedListView({ token, list }: SharedListViewProps) {
  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title={list.name} backHref="/" />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6">
        <div className="flex flex-wrap items-center gap-3">
          <p className="inline-flex items-center gap-1 text-base text-text-muted">
            <Icon name="user" size={16} />
            {list.ownerDisplayName}さんのリスト
          </p>
          <Badge icon="share-2" tone="primary">
            共有リスト（閲覧のみ）
          </Badge>
        </div>

        <ListSpotMap items={list.items} defaultOpen />

        <section aria-labelledby="shared-items-heading" className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 id="shared-items-heading" className="text-lg font-semibold text-text">
              スポット
            </h2>
            <span className="text-base text-text-muted">{list.items.length}件</span>
          </div>
          {list.items.length === 0 ? (
            <EmptyState icon="map-pin" title="このリストにはまだスポットがありません" />
          ) : (
            <ul className="flex flex-col gap-2" aria-label="リスト内のスポット">
              {list.items.map((item) => (
                <ListItemRow key={item.spotId} listId={token} item={item} readOnly />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
