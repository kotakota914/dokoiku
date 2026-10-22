/**
 * Google Routes API（公共交通の移動時間行列。ADR-0022）。サーバーからのみ呼ぶ（API キーは GOOGLE_ROUTES_API_KEY）。
 * 無料枠（組み合わせ件数）の管理は usage.ts / travel.ts 側で行い、ここは HTTP 呼び出しだけを担当する。
 *
 * 公式仕様（https://developers.google.com/maps/documentation/routes/compute_route_matrix）
 * - POST https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix
 *   headers X-Goog-Api-Key、X-Goog-FieldMask: originIndex,destinationIndex,duration,distanceMeters,condition
 *   body { origins: [{ waypoint: { location: { latLng: { latitude, longitude } } } }], destinations: [...],
 *          travelMode: "TRANSIT", departureTime: RFC3339 }
 * - response は要素の配列。duration は "1234s" の文字列、distanceMeters は数値、
 *   condition は ROUTE_EXISTS / ROUTE_NOT_FOUND（運行対象外など）。
 * - 公共交通は 1 回の要素数（出発地 × 目的地）が 100 まで。8 か所＋出発地＋到着地で 10×10 ＝ 100。
 */
import { ApiError } from "@/lib/api/errors";
import { serverConfig } from "@/lib/config";
import { TZ_OFFSET } from "@/lib/domain/constants";
import type { LatLng } from "@/lib/domain/types";
import type { FetchLike } from "./notify";

export const GOOGLE_ROUTES_MATRIX_URL = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";
export const GOOGLE_ROUTES_FIELD_MASK = "originIndex,destinationIndex,duration,distanceMeters,condition";
/** 公共交通の 1 回あたりの要素数の上限 */
export const GOOGLE_ROUTES_TRANSIT_MAX_ELEMENTS = 100;

export interface RouteMatrixElement {
  originIndex: number;
  destinationIndex: number;
  /** 秒。取れなければ null */
  durationSec: number | null;
  /** メートル。取れなければ null */
  distanceM: number | null;
  /** ROUTE_EXISTS のときだけ有効な区間 */
  condition: string;
}

export interface GoogleRoutesOptions {
  fetchImpl?: FetchLike;
  apiKey?: string;
  /** タイムアウト（ms）。既定 10 秒 */
  timeoutMs?: number;
}

/** 出発時刻（params.date ＋ startTime、日本時間）を RFC3339 で */
export function departureTimeRfc3339(date: string, startTime: string): string {
  return `${date}T${startTime}:00${TZ_OFFSET}`;
}

function parseDurationSec(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const m = /^(\d+(?:\.\d+)?)s$/.exec(v.trim());
    if (m) return Math.round(Number(m[1]));
  }
  return null;
}

function toWaypoint(p: LatLng) {
  return { waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } } };
}

export function buildRouteMatrixBody(
  origins: readonly LatLng[],
  destinations: readonly LatLng[],
  departureTime: string,
): Record<string, unknown> {
  return {
    origins: origins.map(toWaypoint),
    destinations: destinations.map(toWaypoint),
    travelMode: "TRANSIT",
    departureTime,
  };
}

/** 公共交通の行列（出発地 × 目的地）。1 回の呼び出しで全要素を取る */
export async function computeRouteMatrix(
  origins: readonly LatLng[],
  destinations: readonly LatLng[],
  departureTime: string,
  opts: GoogleRoutesOptions = {},
): Promise<RouteMatrixElement[]> {
  if (origins.length === 0 || destinations.length === 0) return [];
  const apiKey = opts.apiKey ?? serverConfig.googleRoutesApiKey;
  if (!apiKey) throw ApiError.upstream("公共交通の経路サービスが設定されていません");
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  let res: Response;
  try {
    res = await fetchImpl(GOOGLE_ROUTES_MATRIX_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": GOOGLE_ROUTES_FIELD_MASK,
      },
      body: JSON.stringify(buildRouteMatrixBody(origins, destinations, departureTime)),
      signal: controller.signal,
    });
  } catch (err) {
    console.error("[google-routes] request failed", err instanceof Error ? err.message : err);
    throw ApiError.upstream("公共交通の経路サービスに接続できませんでした");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    // キーはログに出さない
    console.error(`[google-routes] computeRouteMatrix responded ${res.status}`);
    throw ApiError.upstream("公共交通の経路サービスでエラーが発生しました");
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw ApiError.upstream("公共交通の経路サービスの応答を読み取れませんでした");
  }
  if (!Array.isArray(data)) throw ApiError.upstream("公共交通の経路サービスの応答が不正です");
  const out: RouteMatrixElement[] = [];
  for (const raw of data as Record<string, unknown>[]) {
    if (!raw || typeof raw !== "object") continue;
    const originIndex = Number(raw.originIndex ?? 0);
    const destinationIndex = Number(raw.destinationIndex ?? 0);
    if (!Number.isInteger(originIndex) || !Number.isInteger(destinationIndex)) continue;
    const distance = raw.distanceMeters;
    out.push({
      originIndex,
      destinationIndex,
      durationSec: parseDurationSec(raw.duration),
      distanceM: typeof distance === "number" && Number.isFinite(distance) ? Math.round(distance) : null,
      condition: typeof raw.condition === "string" ? raw.condition : "ROUTE_NOT_FOUND",
    });
  }
  return out;
}
