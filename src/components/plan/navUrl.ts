/**
 * 保存済みプランの「ナビを開始」（F-5-12、ADR-0016）。
 * Google マップの道案内 URL を区間ごとに作る純粋関数。API キー不要・無料枠を消費しない。
 * GET /plans/{planId} が segments を返さないときの代替にも使う。
 */
import { GOOGLE_TRAVEL_MODE, type TravelMode } from "@/lib/domain/constants";
import type { LatLng, PlanItem, PlanNavSegment, PlanParams } from "@/lib/domain/types";

export const GOOGLE_MAPS_DIR_PREFIX = "https://www.google.com/maps/dir/";

/** `https://www.google.com/maps/dir/?api=1&origin=lat,lng&destination=lat,lng&travelmode=...` */
export function navUrl(from: LatLng, to: LatLng, mode: TravelMode): string {
  return `${GOOGLE_MAPS_DIR_PREFIX}?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=${GOOGLE_TRAVEL_MODE[mode]}`;
}

/** サーバーから受け取った URL が Google マップの経路 URL か（それ以外は表示しない） */
export function isSafeNavUrl(url: string): boolean {
  return url.startsWith(`${GOOGLE_MAPS_DIR_PREFIX}?`);
}

export interface NavSpot extends LatLng {
  id: string;
  name: string;
}

interface NavPoint extends LatLng {
  index: number;
  label: string;
}

/**
 * 出発地 → 訪問順のスポット → 到着地（あれば）の隣り合う 2 地点ごとに区間を作る。
 * - fromIndex / toIndex は items のインデックス。出発地は -1、到着地は items.length
 * - 昼食休憩は位置を持たないので飛ばす。座標の分からない（削除済み）スポットも飛ばす
 * - 移動手段はプランの移動手段（params.mode）に合わせる
 */
export function buildNavSegments(
  plan: {
    params: Pick<PlanParams, "origin" | "destination" | "mode">;
    result: { items: readonly PlanItem[] };
  },
  spots: readonly NavSpot[],
): PlanNavSegment[] {
  const byId = new Map(spots.map((s) => [s.id, s]));
  const { origin, destination, mode } = plan.params;
  const items = plan.result.items;
  const points: NavPoint[] = [
    { index: -1, lat: origin.lat, lng: origin.lng, label: origin.label || "出発地" },
  ];
  items.forEach((item, index) => {
    if (item.type !== "spot") return;
    const spot = byId.get(item.spotId);
    if (!spot) return;
    points.push({ index, lat: spot.lat, lng: spot.lng, label: spot.name });
  });
  if (destination) {
    points.push({
      index: items.length,
      lat: destination.lat,
      lng: destination.lng,
      label: destination.label || "到着地",
    });
  }
  const segments: PlanNavSegment[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1];
    const to = points[i];
    segments.push({
      fromIndex: from.index,
      toIndex: to.index,
      fromLabel: from.label,
      toLabel: to.label,
      navUrl: navUrl(from, to, mode),
    });
  }
  return segments;
}

/** aria-label：「〇〇から〇〇へのナビをGoogleマップで開く」 */
export function navAriaLabel(segment: Pick<PlanNavSegment, "fromLabel" | "toLabel">): string {
  return `${segment.fromLabel}から${segment.toLabel}へのナビをGoogleマップで開く`;
}
