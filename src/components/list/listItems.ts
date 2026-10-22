/**
 * S-07 / S-08 の端末内計算（純粋関数）：並べ替え（F-4-9）、合計滞在時間（F-4-11）、
 * 比較表示の滞在時間・投稿が多い時間帯（F-4-10）。外部 API は呼ばない。
 */
import {
  CATEGORIES,
  CATEGORY_DEFAULT_STAY_MIN,
  LIMITS,
  POPULARITY_LEVELS,
  type Category,
  type Popularity,
} from "@/lib/domain/constants";
import { distanceFromBase } from "@/lib/domain/distance";
import type { LatLng, SpotSummary, WishlistItem } from "@/lib/domain/types";
import { uuidSchema } from "@/lib/validation/schemas";

/** 並べ替え（listItemsSortSchema の added / distance / popular に、端末内だけで使う category を加えたもの） */
export const LIST_SORTS = ["added", "distance", "popular", "category"] as const;
export type ListSort = (typeof LIST_SORTS)[number];

export const LIST_SORT_LABELS: Record<ListSort, string> = {
  added: "追加順",
  distance: "距離順（拠点から近い順）",
  popular: "人気順",
  category: "カテゴリ別",
};

export const SELECT_MIN = 2;
export const SELECT_MAX = 3;
export const SELECT_RANGE_MESSAGE = `${SELECT_MIN}〜${SELECT_MAX}件選んでください`;
export const BASE_REQUIRED_MESSAGE = "拠点を設定すると距離が表示されます";

const CATEGORY_ORDER: Record<Category, number> = Object.fromEntries(
  CATEGORIES.map((c, i) => [c, i]),
) as Record<Category, number>;
const POPULARITY_ORDER: Record<Popularity, number> = Object.fromEntries(
  POPULARITY_LEVELS.map((p, i) => [p, i]),
) as Record<Popularity, number>;

/** 削除されたスポット（spot が null）は常に末尾。追加順はそのまま */
export function sortListItems(
  items: readonly WishlistItem[],
  sort: ListSort,
  base: LatLng | null | undefined,
): WishlistItem[] {
  const indexed = items.map((item, index) => ({ item, index }));
  const byAdded = (a: { index: number }, b: { index: number }) => a.index - b.index;
  const deletedLast = (a: { item: WishlistItem }, b: { item: WishlistItem }) =>
    Number(a.item.spot === null) - Number(b.item.spot === null);

  if (sort === "added") return items.slice();

  if (sort === "distance") {
    if (!base) return items.slice();
    return indexed
      .sort((a, b) => {
        const d = deletedLast(a, b);
        if (d !== 0) return d;
        const da = distanceFromBase(base, a.item.spot) ?? Number.POSITIVE_INFINITY;
        const db = distanceFromBase(base, b.item.spot) ?? Number.POSITIVE_INFINITY;
        return da - db || byAdded(a, b);
      })
      .map((x) => x.item);
  }

  if (sort === "popular") {
    return indexed
      .sort((a, b) => {
        const d = deletedLast(a, b);
        if (d !== 0) return d;
        const sa = a.item.spot;
        const sb = b.item.spot;
        if (!sa || !sb) return byAdded(a, b);
        return (
          POPULARITY_ORDER[sb.popularity] - POPULARITY_ORDER[sa.popularity] ||
          sb.likeCount - sa.likeCount ||
          sb.postCount - sa.postCount ||
          byAdded(a, b)
        );
      })
      .map((x) => x.item);
  }

  // category：カテゴリ順（CATEGORIES の並び）→ 追加順
  return indexed
    .sort((a, b) => {
      const d = deletedLast(a, b);
      if (d !== 0) return d;
      const sa = a.item.spot;
      const sb = b.item.spot;
      if (!sa || !sb) return byAdded(a, b);
      return CATEGORY_ORDER[sa.category] - CATEGORY_ORDER[sb.category] || byAdded(a, b);
    })
    .map((x) => x.item);
}

/**
 * スポット 1 か所の滞在時間の目安（分）。投稿 LIMITS.stayMedianMinPosts 件以上で中央値があればそれ、
 * なければカテゴリの標準値（11.1 と同じ決め方。SpotSummary には中央値が無いので標準値になる）
 */
export function stayMinutesOf(
  spot: Pick<SpotSummary, "category" | "postCount"> & { stayMinutesMedian?: number | null },
): { minutes: number; source: "median" | "default" } {
  const median = spot.stayMinutesMedian ?? null;
  if (spot.postCount >= LIMITS.stayMedianMinPosts && median !== null && median > 0) {
    return { minutes: median, source: "median" };
  }
  return { minutes: CATEGORY_DEFAULT_STAY_MIN[spot.category], source: "default" };
}

/** F-4-11：リスト内（削除済みを除く）の滞在時間の合計（分） */
export function totalStayMinutes(items: readonly WishlistItem[]): number {
  return items.reduce((sum, item) => (item.spot ? sum + stayMinutesOf(item.spot).minutes : sum), 0);
}

export const TOP_HOURS_MIN_POSTS = 5;

/**
 * 投稿が多い時間帯の上位（最大 count 件、同数なら早い方）。
 * 投稿が minPosts 件未満なら空（画面では「—」）
 */
export function topHours(
  histogram: readonly number[],
  count = 2,
  minPosts: number = TOP_HOURS_MIN_POSTS,
): number[] {
  const values = Array.from({ length: 24 }, (_, h) => {
    const v = histogram[h];
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
  });
  const total = values.reduce((a, b) => a + b, 0);
  if (total < minPosts) return [];
  return values
    .map((v, h) => ({ v, h }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v || a.h - b.h)
    .slice(0, count)
    .map((x) => x.h);
}

/** 「14時台・15時台」。空なら「—」 */
export function formatTopHours(hours: readonly number[]): string {
  if (hours.length === 0) return "—";
  return hours.map((h) => `${h}時台`).join("・");
}

/** 比較画面へのリンク（S-08）。spots はカンマ区切り */
export function compareHref(listId: string, spotIds: readonly string[]): string {
  return `/lists/${encodeURIComponent(listId)}/compare?spots=${encodeURIComponent(spotIds.join(","))}`;
}

/** 比較に進めるのは 2〜3 件のとき */
export function canCompare(count: number): boolean {
  return count >= SELECT_MIN && count <= SELECT_MAX;
}

/**
 * `?spots=a,b,c` を解釈する。UUID 以外・重複・リストに入っていない ID は捨てる（並びは指定順）。
 * 件数の判定（2〜3 件）は表示側で行う
 */
export function parseCompareSpotIds(raw: string, allowed: readonly string[]): string[] {
  const allowedSet = new Set(allowed);
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (!id || !uuidSchema.safeParse(id).success) continue;
    if (!allowedSet.has(id) || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}
