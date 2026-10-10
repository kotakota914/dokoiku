/**
 * OpenRouteService（移動時間行列・経路形状）。サーバーからのみ呼ぶ（API キーは ORS_API_KEY）。
 * 無料枠の回数管理は usage.ts / travel.ts 側で行い、ここは HTTP 呼び出しだけを担当する。
 *
 * 公式仕様（https://openrouteservice.org/dev/#/api-docs）
 * - Matrix:      POST https://api.openrouteservice.org/v2/matrix/{profile}
 *                body { locations: [[lng, lat], ...], metrics: ["duration", "distance"] }
 *                response { durations: (number|null)[][], distances: (number|null)[][] }（秒・メートル、到達不能は null）
 * - Directions:  POST https://api.openrouteservice.org/v2/directions/{profile}/geojson
 *                body { coordinates: [[lng, lat], ...] }
 *                response GeoJSON FeatureCollection。features[0].geometry は LineString（[lng, lat]）
 * - 認証は Authorization ヘッダーに API キーをそのまま入れる。
 * - profile は徒歩 foot-walking、車 driving-car。
 */
import { ApiError } from "@/lib/api/errors";
import { serverConfig } from "@/lib/config";
import type { TravelMode } from "@/lib/domain/constants";
import type { LatLng } from "@/lib/domain/types";
import type { FetchLike } from "./notify";

export const ORS_BASE_URL = "https://api.openrouteservice.org";

export const ORS_PROFILE: Record<TravelMode, "foot-walking" | "driving-car"> = {
  walking: "foot-walking",
  driving: "driving-car",
};

export interface OrsMatrixResult {
  /** [from][to] 秒。到達不能は null */
  durations: (number | null)[][];
  /** [from][to] メートル。到達不能は null */
  distances: (number | null)[][];
}

export interface OrsOptions {
  fetchImpl?: FetchLike;
  apiKey?: string;
  /** タイムアウト（ms）。既定 10 秒 */
  timeoutMs?: number;
}

function requireApiKey(opts: OrsOptions): string {
  const key = opts.apiKey ?? serverConfig.orsApiKey;
  if (!key) throw ApiError.upstream("経路サービスが設定されていません");
  return key;
}

async function postJson<T>(path: string, body: unknown, opts: OrsOptions): Promise<T> {
  const apiKey = requireApiKey(opts);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  let res: Response;
  try {
    res = await fetchImpl(`${ORS_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
        Accept: "application/json, application/geo+json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    console.error("[ors] request failed", err instanceof Error ? err.message : err);
    throw ApiError.upstream("経路サービスに接続できませんでした");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    // レート制限（429）や無効な座標（400/404）も上流エラーとして返す。キーはログに出さない
    console.error(`[ors] ${path} responded ${res.status}`);
    throw ApiError.upstream("経路サービスでエラーが発生しました");
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw ApiError.upstream("経路サービスの応答を読み取れませんでした");
  }
}

function toLocations(points: readonly LatLng[]): [number, number][] {
  return points.map((p) => [p.lng, p.lat]);
}

/** 全地点間の移動時間（秒）と距離（m）の行列。1 回の呼び出しで全ペアを取る */
export async function fetchMatrix(points: readonly LatLng[], mode: TravelMode, opts: OrsOptions = {}): Promise<OrsMatrixResult> {
  if (points.length < 2) return { durations: points.map(() => [0]), distances: points.map(() => [0]) };
  const data = await postJson<Partial<OrsMatrixResult>>(
    `/v2/matrix/${ORS_PROFILE[mode]}`,
    { locations: toLocations(points), metrics: ["duration", "distance"], units: "m" },
    opts,
  );
  if (!Array.isArray(data.durations) || !Array.isArray(data.distances)) {
    throw ApiError.upstream("経路サービスの応答が不正です");
  }
  return { durations: data.durations, distances: data.distances };
}

interface GeoJsonLineFeatureCollection {
  features?: { geometry?: { type?: string; coordinates?: unknown } }[];
}

/** 地点を順にたどる経路形状（LineString の座標 [lng, lat]） */
export async function fetchDirections(points: readonly LatLng[], mode: TravelMode, opts: OrsOptions = {}): Promise<[number, number][]> {
  if (points.length < 2) return toLocations(points);
  const data = await postJson<GeoJsonLineFeatureCollection>(
    `/v2/directions/${ORS_PROFILE[mode]}/geojson`,
    { coordinates: toLocations(points), instructions: false },
    opts,
  );
  const geometry = data.features?.[0]?.geometry;
  if (!geometry || geometry.type !== "LineString" || !Array.isArray(geometry.coordinates)) {
    throw ApiError.upstream("経路サービスの応答が不正です");
  }
  const coords = geometry.coordinates as unknown[];
  const out: [number, number][] = [];
  for (const c of coords) {
    if (Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number") out.push([c[0], c[1]]);
  }
  return out;
}
