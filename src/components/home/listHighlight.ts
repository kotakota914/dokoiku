/**
 * F-1-9：行きたい場所リストを地図で強調表示するための純粋ロジック。
 * GET /api/v1/lists/{listId}（WishlistDetail）から、強調するスポットと拠点を取り出す。
 */
import type { Category } from "@/lib/domain/constants";
import type { LatLng, SpotSummary, WishlistDetail } from "@/lib/domain/types";
import type { MapBaseMarker } from "@/components/map/SpotMap";

export interface ListHighlight {
  listId: string;
  name: string;
  /** 強調するスポットの ID（削除されたスポットは含めない） */
  spotIds: ReadonlySet<string>;
  /** リスト内のスポット（地図に未取得でも強調表示できるよう要約を持つ） */
  spots: SpotSummary[];
  /** 拠点。未設定なら null */
  base: MapBaseMarker | null;
}

export function toListHighlight(detail: WishlistDetail): ListHighlight {
  const spots = detail.items.map((i) => i.spot).filter((s): s is SpotSummary => s !== null);
  const base =
    detail.baseLocation &&
    Number.isFinite(detail.baseLocation.lat) &&
    Number.isFinite(detail.baseLocation.lng)
      ? { lat: detail.baseLocation.lat, lng: detail.baseLocation.lng, label: detail.baseLabel ?? "" }
      : null;
  return {
    listId: detail.id,
    name: detail.name,
    spotIds: new Set(spots.map((s) => s.id)),
    spots,
    base,
  };
}

/**
 * 地図に出すスポット：区画から取得したスポットに、まだ取得していないリストのスポットを足す。
 * カテゴリで絞り込み中なら、そのカテゴリのものだけを足す（F-1-7 と共存させる）。
 */
export function withHighlightedSpots(
  loaded: SpotSummary[],
  highlight: ListHighlight | null,
  categories: readonly Category[],
): SpotSummary[] {
  if (!highlight || highlight.spots.length === 0) return loaded;
  const have = new Set(loaded.map((s) => s.id));
  const extra = highlight.spots.filter(
    (s) => !have.has(s.id) && (categories.length === 0 || categories.includes(s.category)),
  );
  return extra.length === 0 ? loaded : [...loaded, ...extra];
}

/** リストを選んだときに地図を合わせる範囲（スポットと拠点） */
export function highlightFitPoints(highlight: ListHighlight): LatLng[] {
  const points: LatLng[] = highlight.spots.map((s) => ({ lat: s.lat, lng: s.lng }));
  if (highlight.base) points.push({ lat: highlight.base.lat, lng: highlight.base.lng });
  return points;
}

/** 表示中の案内文（例：「金沢旅行」を表示中（5か所）） */
export function highlightSummary(highlight: ListHighlight): string {
  return `「${highlight.name}」を表示中（${highlight.spots.length}か所）`;
}
