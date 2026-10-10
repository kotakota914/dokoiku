/**
 * ADR-0018：外部 API（OpenRouteService）が使えないときの代替。
 * 移動時間は直線距離 × 迂回係数 ÷ 速度で概算し、経路線は地点を結ぶ直線にする。
 * 純粋関数（ブラウザ・サーバー共用可）。
 */
import { FALLBACK_DETOUR_FACTOR, FALLBACK_SPEED_KMH, type TravelMode } from "@/lib/domain/constants";
import type { LatLng } from "@/lib/domain/types";
import { haversineM } from "@/lib/utils/geo";

export interface EstimatedLeg {
  durationSec: number;
  distanceM: number;
}

/** 直線距離 × 1.3 を、徒歩 4.5km/h・車 30km/h で割った概算 */
export function estimateTravel(from: LatLng, to: LatLng, mode: TravelMode): EstimatedLeg {
  const distanceM = Math.round(haversineM(from, to) * FALLBACK_DETOUR_FACTOR);
  const metersPerSec = (FALLBACK_SPEED_KMH[mode] * 1000) / 3600;
  const durationSec = Math.round(distanceM / metersPerSec);
  return { durationSec, distanceM };
}

/** 地点を順に結ぶ LineString（GeoJSON：[lng, lat]） */
export function straightLine(points: readonly LatLng[]): { type: "LineString"; coordinates: [number, number][] } {
  return { type: "LineString", coordinates: points.map((p) => [p.lng, p.lat]) };
}
