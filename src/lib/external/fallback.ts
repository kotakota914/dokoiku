/**
 * ADR-0018 / ADR-0022：外部 API（OpenRouteService / Google Routes）が使えないときの代替。
 * - 徒歩・車：直線距離 × 迂回係数 ÷ 速度で概算する。
 * - 公共交通：直線距離 × 迂回係数 ÷ 15km/h ＋ 待ち時間 10 分（v0.3 Q2）。
 * 経路線は地点を結ぶ直線にする。純粋関数（ブラウザ・サーバー共用可）。
 */
import {
  FALLBACK_DETOUR_FACTOR,
  FALLBACK_SPEED_KMH,
  FALLBACK_TRANSIT_WAIT_MIN,
  type TravelMode,
} from "@/lib/domain/constants";
import type { LatLng } from "@/lib/domain/types";
import { haversineM } from "@/lib/utils/geo";

export interface EstimatedLeg {
  durationSec: number;
  distanceM: number;
}

/**
 * 公共交通で取れない区間を徒歩に置き換えるときの上限（直線距離、m）。
 * これを超える区間は徒歩でも現実的でないため、区間なし（no_route）として扱う（離島など）。
 */
export const FALLBACK_WALK_MAX_M = 50_000;

/** 直線距離 × 1.3 を、徒歩 4.5km/h・車 30km/h・公共交通 15km/h（＋待ち 10 分）で割った概算 */
export function estimateTravel(from: LatLng, to: LatLng, mode: TravelMode): EstimatedLeg {
  const straight = haversineM(from, to);
  if (straight === 0) return { durationSec: 0, distanceM: 0 };
  const distanceM = Math.round(straight * FALLBACK_DETOUR_FACTOR);
  const metersPerSec = (FALLBACK_SPEED_KMH[mode] * 1000) / 3600;
  const wait = mode === "transit" ? FALLBACK_TRANSIT_WAIT_MIN * 60 : 0;
  const durationSec = Math.round(distanceM / metersPerSec) + wait;
  return { durationSec, distanceM };
}

/** 地点を順に結ぶ LineString（GeoJSON：[lng, lat]） */
export function straightLine(points: readonly LatLng[]): {
  type: "LineString";
  coordinates: [number, number][];
} {
  return { type: "LineString", coordinates: points.map((p) => [p.lng, p.lat]) };
}
