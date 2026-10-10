/** 地理計算のユーティリティ（ブラウザ・サーバー共用） */
import type { Bbox } from "@/lib/repo/types";

const EARTH_RADIUS_M = 6_371_000;

export function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** 2点間の直線距離（メートル） */
export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function inBbox(p: { lat: number; lng: number }, b: Bbox): boolean {
  return p.lat >= b.minLat && p.lat <= b.maxLat && p.lng >= b.minLng && p.lng <= b.maxLng;
}

/** 移動時間キャッシュのキー。スポットは `s:{id}`、任意の座標は小数5桁（約1m）に丸めた `c:{lat},{lng}` */
export function coordKey(p: { lat: number; lng: number }): string {
  return `c:${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
}

export function spotKey(spotId: string): string {
  return `s:${spotId}`;
}

/** Google マップで場所を開く URL（APIキー不要、F-3-5） */
export function googleMapsPlaceUrl(p: { lat: number; lng: number }): string {
  return `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
}

/** Google マップで経路を開く URL（F-5-8）。travelmode は walking / driving / transit */
export function googleMapsDirectionsUrl(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  travelmode: "walking" | "driving" | "transit" = "transit",
): string {
  return `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=${travelmode}`;
}

/** 表記ゆれを吸収した比較用の文字列（全角→半角、カタカナ→ひらがな、空白・記号除去、小文字化） */
export function normalizeName(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/[\s　・･\-ー〜~_.,、。()（）「」『』]/g, "");
}
