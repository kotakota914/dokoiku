"use client";

/**
 * 経路プラン（F-5-4）を地図に表示する小さなラッパー。経路線と番号付きマーカーを描き、全体が収まるように寄せる。
 * フェーズ2の経路プラン画面（S-09）・リスト詳細（S-07）から使う。
 */
import { useMemo, type ReactNode } from "react";
import type { LatLng, SpotSummary } from "@/lib/domain/types";
import type { RouteStop } from "@/lib/map/route";
import type { RouteGeometry } from "./SpotMap";
import SpotMapLazy from "./SpotMapLazy";

export interface RouteMapProps {
  geometry: RouteGeometry | null;
  stops: RouteStop[];
  /** 併せて写真ピンも出したいとき（任意） */
  spots?: SpotSummary[];
  selectedSpotId?: string | null;
  onSpotTap?: (spot: SpotSummary) => void;
  interactive?: boolean;
  className?: string;
  children?: ReactNode;
}

export default function RouteMap({
  geometry,
  stops,
  spots,
  selectedSpotId,
  onSpotTap,
  interactive = true,
  className,
  children,
}: RouteMapProps) {
  // 経路線と地点の両方が収まる範囲に寄せる
  const fitTo = useMemo<LatLng[]>(() => {
    const points: LatLng[] = stops.map((s) => ({ lat: s.lat, lng: s.lng }));
    if (geometry) for (const [lng, lat] of geometry.coordinates) points.push({ lat, lng });
    return points;
  }, [geometry, stops]);

  return (
    <SpotMapLazy
      routeGeometry={geometry}
      routeStops={stops}
      spots={spots}
      selectedSpotId={selectedSpotId}
      onSpotTap={onSpotTap}
      fitTo={fitTo.length > 0 ? fitTo : null}
      interactive={interactive}
      className={className}
    >
      {children}
    </SpotMapLazy>
  );
}
