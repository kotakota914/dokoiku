/**
 * 地図タイル（Web メルカトル）の番号と bbox の変換（F-1-2、9.3 GET /spots/tiles/{z}/{x}/{y}）。
 * サーバー（Route Handler）とブラウザ（区画キャッシュ）で共用する純粋関数。
 *
 * たとえ話：地図を「方眼紙のマス目」に切り分け、マスごとに取りに行って手元に貼っていくイメージ。
 * 同じマスは二度取りに行かず、隣のマスは先に取っておく。
 */
import { TILE_ZOOMS } from "@/lib/domain/constants";
import type { MapBbox } from "@/lib/map/view";

export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

/** 表示ズームを取得用ズーム（8 / 11 / 14）に丸める。8 以下 → 8、9〜13 → 11、14 以上 → 14 */
export function fetchZoomFor(viewZoom: number): number {
  const z = Math.round(viewZoom);
  if (z <= 8) return TILE_ZOOMS[0];
  if (z <= 13) return TILE_ZOOMS[1];
  return TILE_ZOOMS[2];
}

export function tileKey(t: TileCoord): string {
  return `${t.z}/${t.x}/${t.y}`;
}

const clampLat = (lat: number) => Math.max(-85.0511, Math.min(85.0511, lat));

/** 緯度経度 → タイル番号（小数は切り捨て） */
export function lngLatToTile(lng: number, lat: number, z: number): TileCoord {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (clampLat(lat) * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { z, x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)) };
}

/** タイル番号 → bbox（minLng, minLat, maxLng, maxLat） */
export function tileToBbox(t: TileCoord): MapBbox {
  const n = 2 ** t.z;
  const lngOf = (x: number) => (x / n) * 360 - 180;
  const latOf = (y: number) => {
    const k = Math.PI - (2 * Math.PI * y) / n;
    return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(k) - Math.exp(-k)));
  };
  return { minLng: lngOf(t.x), maxLng: lngOf(t.x + 1), minLat: latOf(t.y + 1), maxLat: latOf(t.y) };
}

/**
 * bbox を覆うタイル一覧。padding は「外側に何画面分」先読みするか（1 なら bbox と同じ幅・高さ分を四方に広げる）。
 * 上限 maxTiles を超える場合は中心に近いものから返す。
 */
export function tilesForBbox(bbox: MapBbox, z: number, padding = 0, maxTiles = 64): TileCoord[] {
  const w = bbox.maxLng - bbox.minLng;
  const h = bbox.maxLat - bbox.minLat;
  const minLng = Math.max(-180, bbox.minLng - w * padding);
  const maxLng = Math.min(180, bbox.maxLng + w * padding);
  const minLat = Math.max(-85.0511, bbox.minLat - h * padding);
  const maxLat = Math.min(85.0511, bbox.maxLat + h * padding);
  const tl = lngLatToTile(minLng, maxLat, z);
  const br = lngLatToTile(maxLng, minLat, z);
  const cx = (tl.x + br.x) / 2;
  const cy = (tl.y + br.y) / 2;
  const out: TileCoord[] = [];
  for (let x = tl.x; x <= br.x; x++) {
    for (let y = tl.y; y <= br.y; y++) out.push({ z, x, y });
  }
  out.sort((a, b) => (a.x - cx) ** 2 + (a.y - cy) ** 2 - ((b.x - cx) ** 2 + (b.y - cy) ** 2));
  return out.slice(0, maxTiles);
}
