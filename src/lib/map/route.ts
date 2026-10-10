/**
 * 経路プラン（F-5-4）を地図に描くためのデータ変換。
 */
import type { LatLng, PlanItem, PlanPlace } from "@/lib/domain/types";

export type RouteStopKind = "origin" | "spot" | "destination" | "lunch";

/** 地図上の番号付きマーカー */
export interface RouteStop extends LatLng {
  /** 丸の中に表示する短い文字（番号など） */
  label: string;
  kind: RouteStopKind;
  /** 読み上げ用の名前（スポット名、「出発地」など） */
  name?: string;
  spotId?: string;
}

export const ROUTE_STOP_LABELS: Record<Exclude<RouteStopKind, "spot">, string> = {
  origin: "発",
  destination: "着",
  lunch: "昼",
};

/**
 * プランの items から経路マーカーを作る。スポットは訪問順に 1, 2, 3… と番号を振る。
 * 昼食休憩は位置を持たないため、直前の地点に重ねず省略する。
 */
export function buildRouteStops(input: {
  origin: PlanPlace;
  destination: PlanPlace | null;
  items: readonly PlanItem[];
  spotsById: ReadonlyMap<string, LatLng & { name: string }>;
}): RouteStop[] {
  const stops: RouteStop[] = [
    {
      lat: input.origin.lat,
      lng: input.origin.lng,
      label: ROUTE_STOP_LABELS.origin,
      kind: "origin",
      name: input.origin.label || "出発地",
    },
  ];
  let n = 0;
  for (const item of input.items) {
    if (item.type !== "spot") continue;
    const spot = input.spotsById.get(item.spotId);
    if (!spot) continue;
    n += 1;
    stops.push({
      lat: spot.lat,
      lng: spot.lng,
      label: String(n),
      kind: "spot",
      name: spot.name,
      spotId: item.spotId,
    });
  }
  if (input.destination) {
    stops.push({
      lat: input.destination.lat,
      lng: input.destination.lng,
      label: ROUTE_STOP_LABELS.destination,
      kind: "destination",
      name: input.destination.label || "到着地",
    });
  }
  return stops;
}
