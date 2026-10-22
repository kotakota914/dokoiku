/**
 * S-08 スポット比較（v0.3 F-4-10）。2〜3 件を横並びの表で比べる。
 * 項目：代表写真、カテゴリ、人気度、いいね合計、平均的な滞在時間、投稿が多い時間帯、拠点からの距離。
 * スマホでは横スクロール。データは page.tsx（サーバー）が集め、ここは表示だけ（端末内計算のみ）。
 */
import Link from "next/link";
import { LIMITS } from "@/lib/domain/constants";
import { distanceFromBase, formatDistance } from "@/lib/domain/distance";
import type { SpotDetail, Wishlist } from "@/lib/domain/types";
import {
  Badge,
  ButtonLink,
  CategoryLabel,
  EmptyState,
  Icon,
  PageHeader,
  PhotoImage,
  PopularityBadge,
  formatMinutes,
} from "@/components/ui";
import { ListIcon } from "./listIcons";
import {
  BASE_REQUIRED_MESSAGE,
  SELECT_MAX,
  SELECT_MIN,
  SELECT_RANGE_MESSAGE,
  TOP_HOURS_MIN_POSTS,
  formatTopHours,
  stayMinutesOf,
  topHours,
} from "./listItems";

export interface CompareColumn {
  spotId: string;
  /** 削除されたスポットは null（F-4 例外） */
  spot: SpotDetail | null;
}

export interface CompareViewProps {
  list: Pick<Wishlist, "id" | "name" | "baseLabel" | "baseLocation">;
  columns: CompareColumn[];
}

export function listHref(listId: string): string {
  return `/lists/${encodeURIComponent(listId)}`;
}

export function CompareView({ list, columns }: CompareViewProps) {
  const backHref = listHref(list.id);
  const base =
    list.baseLabel && list.baseLocation ? { label: list.baseLabel, location: list.baseLocation } : null;
  const valid = columns.length >= SELECT_MIN && columns.length <= SELECT_MAX;

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title="スポットを比較" backHref={backHref} />
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-6">
        {!valid ? (
          <EmptyState
            icon="triangle-alert"
            title={SELECT_RANGE_MESSAGE}
            description={`リスト「${list.name}」のスポットを${SELECT_MIN}〜${SELECT_MAX}件選ぶと、ここで横並びに比べられます。`}
            action={
              <ButtonLink href={backHref} leftIcon="chevron-left" variant="secondary">
                リストへ戻る
              </ButtonLink>
            }
          />
        ) : (
          <>
            <p className="text-base text-text-muted">
              「{list.name}」の{columns.length}件を比べています。
            </p>
            {!base ? (
              <p className="inline-flex items-center gap-1 text-base text-text-muted">
                <ListIcon name="ruler" size={16} />
                {BASE_REQUIRED_MESSAGE}
              </p>
            ) : null}
            <div className="overflow-x-auto rounded-card border border-border bg-surface">
              <table className="w-full min-w-[30rem] border-collapse text-base" aria-label="スポットの比較">
                <thead>
                  <tr>
                    <th scope="col" className="sr-only">
                      項目
                    </th>
                    {columns.map((c) => (
                      <th
                        key={c.spotId}
                        scope="col"
                        className="min-w-[10rem] border-b border-border p-3 text-left align-top font-semibold"
                      >
                        <SpotHeader column={c} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <CompareRow label="カテゴリ" icon={<Icon name="map-pin" size={16} />} columns={columns}>
                    {(spot) => <CategoryLabel category={spot.category} />}
                  </CompareRow>
                  <CompareRow label="人気度" icon={<Icon name="flame" size={16} />} columns={columns}>
                    {(spot) => <PopularityBadge popularity={spot.popularity} hideNormal={false} />}
                  </CompareRow>
                  <CompareRow label="いいね合計" icon={<Icon name="heart" size={16} />} columns={columns}>
                    {(spot) => <span>{spot.likeCount}件</span>}
                  </CompareRow>
                  <CompareRow
                    label="平均的な滞在時間"
                    icon={<Icon name="clock" size={16} />}
                    columns={columns}
                  >
                    {(spot) => {
                      const stay = stayMinutesOf(spot);
                      return (
                        <span className="flex flex-col">
                          <span>{formatMinutes(stay.minutes)}</span>
                          <span className="text-text-muted">
                            {stay.source === "median" ? "投稿の中央値" : "カテゴリの標準値"}
                          </span>
                        </span>
                      );
                    }}
                  </CompareRow>
                  <CompareRow
                    label="投稿が多い時間帯"
                    icon={<Icon name="camera" size={16} />}
                    columns={columns}
                  >
                    {(spot) => {
                      const hours = topHours(spot.hourHistogram);
                      return (
                        <span className="flex flex-col">
                          <span>{formatTopHours(hours)}</span>
                          {hours.length === 0 ? (
                            <span className="text-text-muted">投稿{TOP_HOURS_MIN_POSTS}件未満</span>
                          ) : null}
                        </span>
                      );
                    }}
                  </CompareRow>
                  <CompareRow
                    label={base ? `${base.label}からの距離` : "拠点からの距離"}
                    icon={<ListIcon name="ruler" size={16} />}
                    columns={columns}
                  >
                    {(spot) => {
                      const d = distanceFromBase(base?.location, spot);
                      return d === null ? (
                        <span className="text-text-muted">拠点未設定</span>
                      ) : (
                        <span>{formatDistance(d)}</span>
                      );
                    }}
                  </CompareRow>
                </tbody>
              </table>
            </div>
            <p className="text-base text-text-muted">
              滞在時間は投稿{LIMITS.stayMedianMinPosts}
              件以上なら投稿の中央値、それ未満ならカテゴリの標準値です。距離は拠点からの直線距離です。
            </p>
            <ButtonLink href={backHref} leftIcon="chevron-left" variant="secondary" className="self-start">
              リストへ戻る
            </ButtonLink>
          </>
        )}
      </div>
    </div>
  );
}

function SpotHeader({ column }: { column: CompareColumn }) {
  const spot = column.spot;
  const name = spot?.name ?? "削除されたスポット";
  return (
    <div className="flex flex-col gap-2">
      <PhotoImage
        src={spot?.coverFullUrl ?? spot?.coverThumbUrl ?? null}
        alt={`${name}の代表写真`}
        category={spot?.category ?? "other"}
        className="aspect-[4/3] w-full rounded-card border border-border object-cover"
        fallbackIconSize={24}
      />
      {spot ? (
        <Link
          href={`/spots/${encodeURIComponent(spot.id)}`}
          className="text-base font-semibold text-text hover:underline"
        >
          {spot.name}
        </Link>
      ) : (
        <Badge icon="triangle-alert" tone="muted">
          このスポットは削除されました
        </Badge>
      )}
    </div>
  );
}

interface CompareRowProps {
  label: string;
  icon: React.ReactNode;
  columns: CompareColumn[];
  children: (spot: SpotDetail) => React.ReactNode;
}

function CompareRow({ label, icon, columns, children }: CompareRowProps) {
  return (
    <tr>
      <th
        scope="row"
        className="w-32 border-b border-border p-3 text-left align-top font-medium text-text-muted"
      >
        <span className="inline-flex items-center gap-1">
          {icon}
          {label}
        </span>
      </th>
      {columns.map((c) => (
        <td key={c.spotId} className="border-b border-border p-3 align-top">
          {c.spot ? children(c.spot) : <span className="text-text-muted">—</span>}
        </td>
      ))}
    </tr>
  );
}
