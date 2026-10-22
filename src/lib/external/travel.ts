/**
 * 移動時間行列の取得（11.2 の 3 / ADR-0022）。経路の形（directions）は取得しない。
 * - 徒歩・車：OpenRouteService の行列。キャッシュで欠けた組み合わせがあれば 1 回だけ呼んで全ペアを保存する。
 *   ORS の回数は 1 呼び出しで 1 回（ors_matrix）。
 * - 公共交通：Google Routes API（computeRouteMatrix、TRANSIT）。キャッシュに無い組み合わせだけを 1 回で取得し、
 *   使用量は組み合わせの件数で数える（google_routes_transit）。キャッシュは timeBucket（平日/休日-出発時）付き。
 *   - キー無し・上限到達・エラーの区間は 15km/h ＋ 待ち 10 分の概算（estimated=true）。
 *   - 運行対象外など（condition != ROUTE_EXISTS）の区間は徒歩の値（キャッシュか概算）で計算する（mode=walking）。
 * - EXTERNAL_API_MOCK=true（F-8-8）は記録済みの結果（無ければ概算）。回数は数えず、キャッシュにも入れない。
 * - 1 回の経路作成で呼ぶ外部 API は最大 1 回（キャッシュですべてそろえば 0 回）。
 */
import { createHash } from "node:crypto";
import { ApiError } from "@/lib/api/errors";
import { serverConfig } from "@/lib/config";
import type { TravelMode } from "@/lib/domain/constants";
import type { LatLng, TravelTimeEntry } from "@/lib/domain/types";
import type { TravelLeg, TravelMatrix } from "@/lib/planner/types";
import type { ApiUsageRepo, TravelCacheRepo } from "@/lib/repo/types";
import { haversineM } from "@/lib/utils/geo";
import { jstWeekday } from "@/lib/utils/time";
import { estimateTravel, FALLBACK_WALK_MAX_M } from "./fallback";
import {
  computeRouteMatrix as defaultComputeRouteMatrix,
  departureTimeRfc3339,
  type RouteMatrixElement,
} from "./google-routes";
import { mockEnabled, mockTravelLeg } from "./mock";
import { fetchMatrix as defaultFetchMatrix, isOrsMode, type OrsMatrixResult, type OrsMode } from "./ors";
import { checkAndCount, type UsageDeps } from "./usage";

/** 徒歩・車のキャッシュの区分（時間帯で変わらない） */
export const TIME_BUCKET_ANY = "any";

export interface TravelPoint extends LatLng {
  /** coordKey() または spotKey() */
  key: string;
}

export interface TravelRepos {
  travelCache: TravelCacheRepo;
  apiUsage: ApiUsageRepo;
}

/** 行列を取得する条件（移動手段と、公共交通の出発時刻の区分に使う日付・開始時刻） */
export interface TravelQuery {
  mode: TravelMode;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM */
  startTime: string;
}

export interface TravelDeps extends UsageDeps {
  /** テストで ORS の行列取得を差し替える */
  fetchMatrix?: (points: readonly LatLng[], mode: OrsMode) => Promise<OrsMatrixResult>;
  /** テストで Google Routes の行列取得を差し替える */
  computeRouteMatrix?: (
    origins: readonly LatLng[],
    destinations: readonly LatLng[],
    departureTime: string,
  ) => Promise<RouteMatrixElement[]>;
  /** テストで ORS の有無を固定する。省略時は ORS_API_KEY の有無 */
  routingEnabled?: boolean;
  /** テストで Google Routes の有無を固定する。省略時は GOOGLE_ROUTES_API_KEY の有無 */
  transitEnabled?: boolean;
}

export interface TravelMatrixResult {
  matrix: TravelMatrix;
  travelMatrixId: string;
  /** 直線距離の概算の区間が 1 つでもあれば true */
  estimated: boolean;
  /** 外部 API を呼んだ回数（0 か 1） */
  externalCalls: number;
}

/**
 * 公共交通のキャッシュの区分：`weekday-09` / `holiday-14`（date の曜日と startTime の時。日本時間）。
 * 休日は土日（祝日は扱わない）。徒歩・車は "any"。
 */
export function timeBucketFor(query: TravelQuery): string {
  if (query.mode !== "transit") return TIME_BUCKET_ANY;
  const wd = jstWeekday(query.date);
  const kind = wd === 0 || wd === 6 ? "holiday" : "weekday";
  return `${kind}-${query.startTime.slice(0, 2)}`;
}

/** "tm_" + mode + "_" + （キーを sort して結合した文字列＋公共交通は区分）の sha1 の先頭 16 桁 */
export function travelMatrixIdOf(
  keys: readonly string[],
  mode: TravelMode,
  timeBucket = TIME_BUCKET_ANY,
): string {
  const joined = keys.slice().sort().join("|") + (timeBucket === TIME_BUCKET_ANY ? "" : `#${timeBucket}`);
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

type Pair = { from: TravelPoint; to: TravelPoint };

function allPairs(points: readonly TravelPoint[]): Pair[] {
  const pairs: Pair[] = [];
  for (const a of points) for (const b of points) if (a.key !== b.key) pairs.push({ from: a, to: b });
  return pairs;
}

function pairKey(fromKey: string, toKey: string): string {
  return `${fromKey}|${toKey}`;
}

/** 区間の徒歩距離（m）。徒歩は距離そのもの、車は 0、公共交通は不明（null） */
function walkMOf(mode: TravelMode, distanceM: number): number | null {
  if (mode === "walking") return distanceM;
  if (mode === "driving") return 0;
  return null;
}

/** キャッシュ・外部 API から取れた区間 */
export function legFromEntry(mode: TravelMode, e: { durationSec: number; distanceM: number }): TravelLeg {
  return {
    durationSec: e.durationSec,
    distanceM: e.distanceM,
    estimated: false,
    mode,
    walkM: walkMOf(mode, e.distanceM),
  };
}

/** 直線距離からの概算の区間 */
export function estimatedLeg(from: LatLng, to: LatLng, mode: TravelMode): TravelLeg {
  const e = estimateTravel(from, to, mode);
  return { ...e, estimated: true, mode, walkM: walkMOf(mode, e.distanceM) };
}

function routingEnabled(deps: TravelDeps): boolean {
  return deps.routingEnabled ?? !!serverConfig.orsApiKey;
}

function transitEnabled(deps: TravelDeps): boolean {
  return deps.transitEnabled ?? !!serverConfig.googleRoutesApiKey;
}

function isEstimated(matrix: TravelMatrix): boolean {
  for (const leg of matrix.values()) if (leg.estimated) return true;
  return false;
}

/**
 * 出発地・スポット・到着地の全ペアの行列を用意する。キャッシュ優先、外部 API は最大 1 回。
 * 徒歩・車で ORS が上限到達なら 503 をそのまま投げる。上流エラーは概算で代替する。
 */
export async function getTravelMatrix(
  repo: TravelRepos,
  points: readonly TravelPoint[],
  query: TravelQuery,
  deps: TravelDeps = {},
): Promise<TravelMatrixResult> {
  const { mode } = query;
  const pts = uniquePoints(points);
  const bucket = timeBucketFor(query);
  const travelMatrixId = travelMatrixIdOf(
    pts.map((p) => p.key),
    mode,
    bucket,
  );
  const pairs = allPairs(pts);
  const matrix: TravelMatrix = new Map();
  if (pairs.length === 0) return { matrix, travelMatrixId, estimated: false, externalCalls: 0 };

  const cached = await repo.travelCache.getMany(
    pairs.map((p) => ({ fromKey: p.from.key, toKey: p.to.key })),
    mode,
    bucket,
  );
  const missing: Pair[] = [];
  for (const pair of pairs) {
    const k = pairKey(pair.from.key, pair.to.key);
    const e = cached.get(k);
    if (e) matrix.set(k, legFromEntry(mode, e));
    else missing.push(pair);
  }
  const done = (externalCalls: number): TravelMatrixResult => ({
    matrix,
    travelMatrixId,
    estimated: isEstimated(matrix),
    externalCalls,
  });
  if (missing.length === 0) return done(0);

  if (mockEnabled(deps.mock)) {
    for (const { from, to } of missing) matrix.set(pairKey(from.key, to.key), mockTravelLeg(from, to, mode));
    return done(0);
  }
  if (isOrsMode(mode)) return done(await fillFromOrs(repo, pts, missing, matrix, mode, deps));
  return done(await fillFromGoogleRoutes(repo, missing, matrix, query, bucket, deps));
}

/** 徒歩・車：ORS を 1 回呼んで全ペアを更新する。キー無し・上流エラーは概算 */
async function fillFromOrs(
  repo: TravelRepos,
  pts: readonly TravelPoint[],
  missing: readonly Pair[],
  matrix: TravelMatrix,
  mode: OrsMode,
  deps: TravelDeps,
): Promise<number> {
  const fillEstimates = () => {
    for (const { from, to } of missing) matrix.set(pairKey(from.key, to.key), estimatedLeg(from, to, mode));
  };
  if (!routingEnabled(deps)) {
    fillEstimates();
    return 0;
  }
  // 停止中・上限到達なら checkAndCount が 503 を投げる（呼び出さない。F-8-2）
  await checkAndCount(repo.apiUsage, "ors_matrix", 1, deps);
  const fetchMatrix = deps.fetchMatrix ?? ((p, m) => defaultFetchMatrix(p, m));
  let result: OrsMatrixResult;
  try {
    result = await fetchMatrix(pts, mode);
  } catch (err) {
    if (err instanceof ApiError && err.code === "FEATURE_SUSPENDED") throw err;
    console.error(
      "[travel] ors matrix failed, using estimates",
      err instanceof Error ? err.message : "error",
    );
    fillEstimates();
    return 1;
  }
  const entries: Omit<TravelTimeEntry, "fetchedAt">[] = [];
  for (let i = 0; i < pts.length; i += 1) {
    for (let j = 0; j < pts.length; j += 1) {
      if (i === j) continue;
      const durationSec = result.durations[i]?.[j];
      const distanceM = result.distances[i]?.[j];
      const k = pairKey(pts[i].key, pts[j].key);
      // 到達不能（null）はキャッシュにも行列にも入れない → planner 側で no_route になる
      if (typeof durationSec !== "number" || typeof distanceM !== "number" || !Number.isFinite(durationSec)) {
        matrix.delete(k);
        continue;
      }
      const leg = { durationSec: Math.round(durationSec), distanceM: Math.round(distanceM) };
      matrix.set(k, legFromEntry(mode, leg));
      entries.push({ fromKey: pts[i].key, toKey: pts[j].key, mode, timeBucket: TIME_BUCKET_ANY, ...leg });
    }
  }
  if (entries.length > 0) await repo.travelCache.putMany(entries);
  return 1;
}

/** 公共交通の区間が取れないときの徒歩の値（徒歩のキャッシュか概算）。遠すぎれば null（no_route） */
async function walkingFallback(
  repo: TravelRepos,
  pairs: readonly Pair[],
): Promise<Map<string, TravelLeg | null>> {
  const out = new Map<string, TravelLeg | null>();
  if (pairs.length === 0) return out;
  const cached = await repo.travelCache.getMany(
    pairs.map((p) => ({ fromKey: p.from.key, toKey: p.to.key })),
    "walking",
    TIME_BUCKET_ANY,
  );
  for (const { from, to } of pairs) {
    const k = pairKey(from.key, to.key);
    const e = cached.get(k);
    if (e) out.set(k, legFromEntry("walking", e));
    else if (haversineM(from, to) > FALLBACK_WALK_MAX_M) out.set(k, null);
    else out.set(k, estimatedLeg(from, to, "walking"));
  }
  return out;
}

/** 公共交通で呼ぶ組み合わせの件数（出発地の集合 × 目的地の集合から同じ地点どうしを除く） */
export function transitElementCount(
  origins: readonly TravelPoint[],
  destinations: readonly TravelPoint[],
): number {
  const destKeys = new Set(destinations.map((d) => d.key));
  const same = origins.filter((o) => destKeys.has(o.key)).length;
  return origins.length * destinations.length - same;
}

/**
 * 公共交通：キャッシュに無い組み合わせだけを Google Routes で 1 回取得する。
 * 使用量は呼んだ組み合わせの件数（transitElementCount）で数える。
 */
async function fillFromGoogleRoutes(
  repo: TravelRepos,
  missing: readonly Pair[],
  matrix: TravelMatrix,
  query: TravelQuery,
  bucket: string,
  deps: TravelDeps,
): Promise<number> {
  const fillEstimates = () => {
    for (const { from, to } of missing)
      matrix.set(pairKey(from.key, to.key), estimatedLeg(from, to, "transit"));
  };
  if (!transitEnabled(deps)) {
    fillEstimates();
    return 0;
  }

  const origins = uniquePoints(missing.map((p) => p.from));
  const destinations = uniquePoints(missing.map((p) => p.to));
  let counted = false;
  let elements: RouteMatrixElement[];
  try {
    await checkAndCount(
      repo.apiUsage,
      "google_routes_transit",
      transitElementCount(origins, destinations),
      deps,
    );
    counted = true;
    const compute = deps.computeRouteMatrix ?? ((o, d, t) => defaultComputeRouteMatrix(o, d, t));
    elements = await compute(origins, destinations, departureTimeRfc3339(query.date, query.startTime));
  } catch (err) {
    // 上限到達（503）・上流エラーは概算で代替する（ADR-0022）。入口の停止中チェックは services/plans.ts
    console.error(
      "[travel] google routes unavailable, using estimates",
      err instanceof ApiError ? err.code : err instanceof Error ? err.message : "error",
    );
    fillEstimates();
    return counted ? 1 : 0;
  }

  const fetched = new Map<string, RouteMatrixElement>();
  for (const el of elements) {
    const o = origins[el.originIndex];
    const d = destinations[el.destinationIndex];
    if (o && d) fetched.set(pairKey(o.key, d.key), el);
  }
  const entries: Omit<TravelTimeEntry, "fetchedAt">[] = [];
  const notFound: Pair[] = [];
  for (const pair of missing) {
    const k = pairKey(pair.from.key, pair.to.key);
    const el = fetched.get(k);
    if (el && el.condition === "ROUTE_EXISTS" && el.durationSec !== null) {
      const distanceM = el.distanceM ?? Math.round(haversineM(pair.from, pair.to));
      const leg = { durationSec: Math.round(el.durationSec), distanceM };
      matrix.set(k, legFromEntry("transit", leg));
      entries.push({
        fromKey: pair.from.key,
        toKey: pair.to.key,
        mode: "transit",
        timeBucket: bucket,
        ...leg,
      });
    } else {
      notFound.push(pair);
    }
  }
  if (entries.length > 0) await repo.travelCache.putMany(entries);
  for (const [k, leg] of await walkingFallback(repo, notFound)) {
    if (leg) matrix.set(k, leg);
    else matrix.delete(k);
  }
  return 1;
}

/**
 * 再計算（F-5-10）用：決まった順の連続する区間をキャッシュから引く。外部 API は呼ばない。
 * キャッシュに無い区間は、モック中は記録済みの結果、それ以外は概算（公共交通は 15km/h ＋ 待ち 10 分）。
 */
export async function getLegsOffline(
  repo: Pick<TravelRepos, "travelCache">,
  sequence: readonly TravelPoint[],
  query: TravelQuery,
  deps: Pick<TravelDeps, "mock"> = {},
): Promise<TravelMatrix> {
  const { mode } = query;
  const bucket = timeBucketFor(query);
  const pairs: Pair[] = [];
  for (let i = 1; i < sequence.length; i += 1) {
    if (sequence[i - 1].key !== sequence[i].key) pairs.push({ from: sequence[i - 1], to: sequence[i] });
  }
  const matrix: TravelMatrix = new Map();
  if (pairs.length === 0) return matrix;
  const cached = await repo.travelCache.getMany(
    pairs.map((p) => ({ fromKey: p.from.key, toKey: p.to.key })),
    mode,
    bucket,
  );
  const mock = mockEnabled(deps.mock);
  for (const { from, to } of pairs) {
    const k = pairKey(from.key, to.key);
    const e = cached.get(k);
    if (e) matrix.set(k, legFromEntry(mode, e));
    else matrix.set(k, mock ? mockTravelLeg(from, to, mode) : estimatedLeg(from, to, mode));
  }
  return matrix;
}
