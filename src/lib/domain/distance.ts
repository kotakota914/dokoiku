/**
 * v0.3 F-4-8：拠点からの直線距離（端末内で計算。外部 API は呼ばない）。
 * ブラウザ・サーバーのどちらからも使える純粋関数。
 */
import { haversineM } from "@/lib/utils/geo";
import type { LatLng } from "./types";

/** 1km 未満は 10m 単位で「約350m」、1km 以上は小数 1 桁で「約2.3km」 */
export function formatDistance(meters: number): string {
  const m = Math.max(0, meters);
  const rounded10 = Math.round(m / 10) * 10;
  if (rounded10 < 1000) return `約${rounded10}m`;
  return `約${(m / 1000).toFixed(1)}km`;
}

/** 拠点からの直線距離（m）。拠点または地点が無ければ null */
export function distanceFromBase(
  base: LatLng | null | undefined,
  point: LatLng | null | undefined,
): number | null {
  if (!base || !point) return null;
  return haversineM(base, point);
}
