/**
 * 地図の表示位置に関する純粋ロジック（F-1-1、URL ハッシュ）。ブラウザ・テストの両方で動く。
 */
import {
  DEFAULT_VIEW,
  JAPAN_CENTER,
  MAP_ZOOM,
  USE_DEFAULT_VIEW_WHEN_DENIED,
  mapModeForZoom,
  type MapMode,
} from "@/lib/domain/constants";
import type { LatLng } from "@/lib/domain/types";

/** 表示範囲（GET /spots の bbox と同じ並び） */
export interface MapBbox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export interface MapView {
  center: LatLng;
  zoom: number;
}

export interface InitialViewOptions {
  /**
   * 位置情報が無いとき DEFAULT_VIEW（金沢市中心部、ズーム13）を使うか（v0.3 Q4-B、ADR-0026）。
   * false なら日本全体（ズーム5）。既定は USE_DEFAULT_VIEW_WHEN_DENIED
   */
  useDefaultWhenDenied?: boolean;
}

/**
 * F-1-1：位置情報があれば現在地周辺（ズーム13）。
 * なければ DEFAULT_VIEW（金沢市中心部、ズーム13）、USE_DEFAULT_VIEW_WHEN_DENIED が false なら日本全体（ズーム5）。
 * URL ハッシュがあるときは呼び出し側（MapLibre の hash オプション）がそちらを優先する。
 */
export function getInitialView(
  position: LatLng | null | undefined,
  { useDefaultWhenDenied = USE_DEFAULT_VIEW_WHEN_DENIED }: InitialViewOptions = {},
): MapView {
  if (position && Number.isFinite(position.lat) && Number.isFinite(position.lng)) {
    return { center: { lat: position.lat, lng: position.lng }, zoom: MAP_ZOOM.initialWithLocation };
  }
  if (useDefaultWhenDenied) {
    return {
      center: { lat: DEFAULT_VIEW.center.lat, lng: DEFAULT_VIEW.center.lng },
      zoom: DEFAULT_VIEW.zoom,
    };
  }
  return { center: { lat: JAPAN_CENTER.lat, lng: JAPAN_CENTER.lng }, zoom: MAP_ZOOM.initialWithoutLocation };
}

export { mapModeForZoom };
export type { MapMode };

/**
 * URL ハッシュ "#zoom/lat/lng[/bearing[/pitch]]" を読む（MapLibre の hash オプションと同じ形式）。
 * 形式が違う・範囲外なら null。
 */
export function parseHash(hash: string): MapView | null {
  const body = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!body) return null;
  const parts = body.split("/");
  if (parts.length < 3) return null;
  const zoom = Number(parts[0]);
  const lat = Number(parts[1]);
  const lng = Number(parts[2]);
  if (![zoom, lat, lng].every(Number.isFinite)) return null;
  if (zoom < 0 || zoom > 24 || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { center: { lat, lng }, zoom };
}

/** MapLibre と同じ丸め（ズームは小数2桁、座標はズームに応じた桁数）で "#zoom/lat/lng" を作る */
export function formatHash(view: MapView): string {
  const zoom = Math.round(view.zoom * 100) / 100;
  const precision = Math.max(0, Math.ceil((zoom * Math.LN2 + Math.log(512 / 360 / 0.5)) / Math.LN10));
  const m = 10 ** precision;
  const lat = Math.round(view.center.lat * m) / m;
  const lng = Math.round(view.center.lng * m) / m;
  return `#${zoom}/${lat}/${lng}`;
}

/** 点の集合を囲む bbox。空なら null */
export function bboxOfPoints(points: readonly LatLng[]): MapBbox | null {
  if (points.length === 0) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const p of points) {
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
  }
  return { minLng, minLat, maxLng, maxLat };
}

/** bbox を縦横それぞれ ratio 倍だけ広げる（画面外のマーカーを少し先読みするため） */
export function expandBbox(b: MapBbox, ratio: number): MapBbox {
  const dLng = (b.maxLng - b.minLng) * ratio;
  const dLat = (b.maxLat - b.minLat) * ratio;
  return {
    minLng: Math.max(-180, b.minLng - dLng),
    minLat: Math.max(-90, b.minLat - dLat),
    maxLng: Math.min(180, b.maxLng + dLng),
    maxLat: Math.min(90, b.maxLat + dLat),
  };
}

export function bboxContains(b: MapBbox, p: LatLng): boolean {
  return p.lat >= b.minLat && p.lat <= b.maxLat && p.lng >= b.minLng && p.lng <= b.maxLng;
}

/** GET /spots の bbox クエリ文字列（小数5桁≒1m に丸めて URL の揺れを抑える） */
export function bboxToQuery(b: MapBbox): string {
  return [b.minLng, b.minLat, b.maxLng, b.maxLat].map((v) => v.toFixed(5)).join(",");
}
