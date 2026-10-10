/**
 * 移動時間行列と経路形状の取得（11.3 / 11.8）。
 * - 全ペアをキャッシュ（travel_time_cache）から引き、1 つでも欠けていれば ORS を 1 回だけ呼んで全ペアを保存する。
 * - ORS が未設定なら直線距離で概算する（estimated=true、キャッシュには入れない。ADR-0018）。
 * - 1 回の経路作成で呼ぶ外部 API は最大 2 回（行列 1 回＋経路形状 1 回）。
 */
import { createHash } from "node:crypto";
import { ApiError } from "@/lib/api/errors";
import { serverConfig } from "@/lib/config";
import type { TravelMode } from "@/lib/domain/constants";
import type { LatLng, TravelTimeEntry } from "@/lib/domain/types";
import type { ApiUsageRepo, TravelCacheRepo } from "@/lib/repo/types";
import type { TravelMatrix } from "@/lib/planner/types";
import { estimateTravel, straightLine } from "./fallback";
import { fetchDirections as defaultFetchDirections, fetchMatrix as defaultFetchMatrix, type OrsMatrixResult } from "./ors";
import { checkAndCount, type UsageDeps } from "./usage";

export interface TravelPoint extends LatLng {
  /** coordKey() または spotKey() */
  key: string;
}

export interface TravelRepos {
  travelCache: TravelCacheRepo;
  apiUsage: ApiUsageRepo;
}

export interface TravelDeps extends UsageDeps {
  fetchMatrix?: (points: readonly LatLng[], mode: TravelMode) => Promise<OrsMatrixResult>;
  fetchDirections?: (points: readonly LatLng[], mode: TravelMode) => Promise<[number, number][]>;
  /** テストで ORS の有無を固定する。省略時は ORS_API_KEY の有無 */
  routingEnabled?: boolean;
}

export interface TravelMatrixResult {
  matrix: TravelMatrix;
  travelMatrixId: string;
  /** 直線距離の概算なら true */
  estimated: boolean;
}

function routingEnabled(deps: TravelDeps): boolean {
  return deps.routingEnabled ?? !!serverConfig.orsApiKey;
}

/** "tm_" + mode + "_" + キーを sort して結合した文字列の sha1 の先頭 16 桁 */
export function travelMatrixIdOf(keys: readonly string[], mode: TravelMode): string {
  const joined = keys.slice().sort().join("|");
  const hash = createHash("sha1").update(joined).digest("hex").slice(0, 16);
  return `tm_${mode}_${hash}`;
}

/** 同じキーの地点をまとめる（出発地と到着地が同じ座標のときなど） */
function uniquePoints(points: readonly TravelPoint[]): TravelPoint[] {
  const seen = new Set<string>();
  const out: TravelPoint[] = [];
  for (const p of points) {
    if (seen.has(p.key)) continue;
    seen.add(p.key);
    out.push(p);
  }
  return out;
}

function allPairs(points: readonly TravelPoint[]): { fromKey: string; toKey: string }[] {
  const pairs: { fromKey: string; toKey: string }[] = [];
  for (const a of points) for (const b of points) if (a.key !== b.key) pairs.push({ fromKey: a.key, toKey: b.key });
  return pairs;
}

export async function getTravelMatrix(
  repo: TravelRepos,
  points: readonly TravelPoint[],
  mode: TravelMode,
  deps: TravelDeps = {},
): Promise<TravelMatrixResult> {
  const pts = uniquePoints(points);
  const travelMatrixId = travelMatrixIdOf(
    pts.map((p) => p.key),
    mode,
  );
  const pairs = allPairs(pts);
  const matrix: TravelMatrix = new Map();
  if (pairs.length === 0) return { matrix, travelMatrixId, estimated: false };

  const cached = await repo.travelCache.getMany(pairs, mode);
  let missing = 0;
  for (const pair of pairs) {
    const k = `${pair.fromKey}|${pair.toKey}`;
    const e = cached.get(k);
    if (e) matrix.set(k, { durationSec: e.durationSec, distanceM: e.distanceM });
    else missing += 1;
  }
  if (missing === 0) return { matrix, travelMatrixId, estimated: false };

  if (!routingEnabled(deps)) {
    // 概算：全ペアを直線距離から計算し、キャッシュには入れない
    const estimated: TravelMatrix = new Map();
    for (const a of pts) for (const b of pts) if (a.key !== b.key) estimated.set(`${a.key}|${b.key}`, estimateTravel(a, b, mode));
    return { matrix: estimated, travelMatrixId, estimated: true };
  }

  // ORS を 1 回だけ呼んで全ペアを更新する（停止中・上限到達なら checkAndCount が 503 を投げる）
  await checkAndCount(repo.apiUsage, "ors_matrix", 1, deps);
  const fetchMatrix = deps.fetchMatrix ?? ((p, m) => defaultFetchMatrix(p, m));
  const result = await fetchMatrix(pts, mode);
  const fresh: TravelMatrix = new Map();
  const entries: Omit<TravelTimeEntry, "fetchedAt">[] = [];
  for (let i = 0; i < pts.length; i += 1) {
    for (let j = 0; j < pts.length; j += 1) {
      if (i === j) continue;
      const durationSec = result.durations[i]?.[j];
      const distanceM = result.distances[i]?.[j];
      // 到達不能（null）はキャッシュにも行列にも入れない → planner 側で no_route になる
      if (typeof durationSec !== "number" || typeof distanceM !== "number" || !Number.isFinite(durationSec)) continue;
      const leg = { durationSec: Math.round(durationSec), distanceM: Math.round(distanceM) };
      fresh.set(`${pts[i].key}|${pts[j].key}`, leg);
      entries.push({ fromKey: pts[i].key, toKey: pts[j].key, mode, ...leg });
    }
  }
  if (entries.length > 0) await repo.travelCache.putMany(entries);
  return { matrix: fresh, travelMatrixId, estimated: false };
}

export interface RouteGeometryResult {
  geometry: { type: "LineString"; coordinates: [number, number][] };
  /** 直線で代替したら true */
  estimated: boolean;
}

/**
 * 決まった順の経路形状。ORS があれば 1 回呼び、無ければ直線で結ぶ。
 * ORS の上流エラー時も直線で代替する（停止中の 503 はそのまま投げる）。
 */
export async function getRouteGeometry(
  repo: TravelRepos,
  orderedPoints: readonly LatLng[],
  mode: TravelMode,
  deps: TravelDeps = {},
): Promise<RouteGeometryResult> {
  if (orderedPoints.length < 2 || !routingEnabled(deps)) {
    return { geometry: straightLine(orderedPoints), estimated: orderedPoints.length >= 2 };
  }
  await checkAndCount(repo.apiUsage, "ors_directions", 1, deps);
  const fetchDirections = deps.fetchDirections ?? ((p, m) => defaultFetchDirections(p, m));
  try {
    const coordinates = await fetchDirections(orderedPoints, mode);
    if (coordinates.length < 2) return { geometry: straightLine(orderedPoints), estimated: true };
    return { geometry: { type: "LineString", coordinates }, estimated: false };
  } catch (err) {
    if (err instanceof ApiError && err.code === "FEATURE_SUSPENDED") throw err;
    console.error("[travel] directions failed, falling back to straight line", err instanceof Error ? err.message : err);
    return { geometry: straightLine(orderedPoints), estimated: true };
  }
}
