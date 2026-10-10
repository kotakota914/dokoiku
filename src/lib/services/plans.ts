/**
 * 経路プラン API の業務ロジック（F-5 / 11章）。
 * Route Handler は「認証 → 入力検証 → ここを呼ぶ → レスポンス」だけを行う。
 * - compute  : 行列 1 回＋経路形状 1 回を上限に外部 API を呼ぶ（travel.ts の設計で保証）。停止中は 503。
 * - recompute: 外部 API を呼ばない。移動時間はキャッシュ、無い区間は直線距離の概算で埋める。
 * Repository の契約（src/lib/repo/types.ts）だけに依存し、"server-only" は import しない（vitest から直接テストするため）。
 */
import { ApiError } from "@/lib/api/errors";
import type { TravelMode } from "@/lib/domain/constants";
import type {
  LatLng,
  Plan,
  PlanItem,
  PlanParams,
  PlanResult,
  SkipReason,
  WishlistDetail,
} from "@/lib/domain/types";
import { estimateTravel, straightLine } from "@/lib/external/fallback";
import { getRouteGeometry, getTravelMatrix, type TravelDeps, type TravelPoint } from "@/lib/external/travel";
import { isSuspended, suspendedMessage } from "@/lib/external/usage";
import { buildSchedule, planRoute, type PlannerSpot, type TravelMatrix } from "@/lib/planner";
import type { Repository } from "@/lib/repo/types";
import { coordKey, spotKey } from "@/lib/utils/geo";
import { hhmmToMinutes, minutesToHHMM } from "@/lib/utils/time";
import type { PlanComputeInput, PlanRecomputeInput, PlanSaveInput } from "@/lib/validation/schemas";
import { getOwnedWishlist } from "./lists";

export const PLAN_NOT_FOUND_MESSAGE = "プランが見つかりませんでした";
export const SPOT_NOT_IN_LIST_MESSAGE = "リストに入っていないスポットが含まれています";
export const ORDER_NOT_IN_SPOTS_MESSAGE = "対象に含まれないスポットが並び順に含まれています";

type PlanComputeDeps = Pick<Repository, "wishlists" | "spots" | "travelCache" | "apiUsage">;
type PlanStoreDeps = Pick<Repository, "wishlists" | "plans">;

/** テストで外部 API の有無・fetch・時刻を差し替える（travel.ts と同じ） */
export type PlanDeps = TravelDeps;

interface ResolvedSpots {
  /** 経路計算に使うスポット（削除済みを除く） */
  spots: PlannerSpot[];
  /** 削除済み（存在しない・公開投稿 0 件）のスポット */
  skipped: { spotId: string; reason: SkipReason }[];
}

function unique<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}

/** spotIds がすべてリストに入っているか確認する（入っていなければ 400） */
function assertSpotsInList(list: WishlistDetail, spotIds: readonly string[]): void {
  const inList = new Set(list.items.map((i) => i.spotId));
  const missing = spotIds.filter((id) => !inList.has(id));
  if (missing.length > 0) {
    throw ApiError.validation(
      SPOT_NOT_IN_LIST_MESSAGE,
      missing.map((id) => ({ field: "spotIds", reason: "not_in_list", spotId: id })),
    );
  }
}

/**
 * スポットを取得して planner の入力にする。
 * 存在しない・公開投稿が 0 件のスポットは「削除された」扱いで skipped（F-4 例外）。mustVisit はリストの項目から取る。
 */
async function resolvePlannerSpots(
  repo: Pick<Repository, "spots">,
  list: WishlistDetail,
  spotIds: readonly string[],
): Promise<ResolvedSpots> {
  const mustVisit = new Map(list.items.map((i) => [i.spotId, i.mustVisit]));
  const spots: PlannerSpot[] = [];
  const skipped: ResolvedSpots["skipped"] = [];
  for (const spotId of spotIds) {
    const spot = await repo.spots.getById(spotId);
    if (!spot || spot.postCount <= 0) {
      skipped.push({ spotId, reason: "deleted" });
      continue;
    }
    spots.push({
      id: spot.id,
      name: spot.name,
      lat: spot.lat,
      lng: spot.lng,
      category: spot.category,
      postCount: spot.postCount,
      stayMinutesMedian: spot.stayMinutesMedian,
      hourHistogram: spot.hourHistogram,
      openingHours: spot.openingHours,
      mustVisit: mustVisit.get(spotId) ?? false,
    });
  }
  return { spots, skipped };
}

/** 訪問順どおりの座標列（出発地 → スポット → 到着地） */
function orderedCoordinates(
  params: Pick<PlanParams, "origin" | "destination">,
  items: readonly PlanItem[],
  spots: readonly PlannerSpot[],
): LatLng[] {
  const byId = new Map(spots.map((s) => [s.id, s]));
  const coords: LatLng[] = [{ lat: params.origin.lat, lng: params.origin.lng }];
  for (const item of items) {
    if (item.type !== "spot") continue;
    const s = byId.get(item.spotId);
    if (s) coords.push({ lat: s.lat, lng: s.lng });
  }
  if (params.destination) coords.push({ lat: params.destination.lat, lng: params.destination.lng });
  return coords;
}

function hasSpotItem(items: readonly PlanItem[]): boolean {
  return items.some((i) => i.type === "spot");
}

/**
 * POST /plans/compute（F-5-3）
 * 1. 停止中（F-8）なら 503。リストは本人のもの。spotIds はすべてリストに入っていること（400）。
 * 2. 移動時間行列（キャッシュ → 無ければ外部 1 回、未設定なら概算）。
 * 3. planRoute で訪問順と時刻を決める。
 * 4. スポットが 1 つ以上入れば経路形状（外部 1 回、未設定なら直線）。
 */
export async function computePlan(
  repo: PlanComputeDeps,
  userId: string,
  input: PlanComputeInput,
  deps: PlanDeps = {},
): Promise<PlanResult> {
  const now = deps.now ?? new Date();
  if (await isSuspended(repo.apiUsage, "route_planning", now)) {
    throw ApiError.suspended("route_planning", suspendedMessage("route_planning"));
  }
  const list = await getOwnedWishlist(repo, userId, input.listId);
  const spotIds = unique(input.spotIds);
  assertSpotsInList(list, spotIds);

  const { spots, skipped } = await resolvePlannerSpots(repo, list, spotIds);
  const originKey = coordKey(input.origin);
  const destinationKey = input.destination ? coordKey(input.destination) : null;
  const points: TravelPoint[] = [
    { key: originKey, lat: input.origin.lat, lng: input.origin.lng },
    ...spots.map((s) => ({ key: spotKey(s.id), lat: s.lat, lng: s.lng })),
  ];
  if (input.destination)
    points.push({ key: destinationKey!, lat: input.destination.lat, lng: input.destination.lng });

  // 対象が残らなければ外部 API を呼ばずに空の結果を返す（スポットはすべて skipped）
  if (spots.length === 0) {
    const empty = await getTravelMatrix(repo, [points[0]], input.mode, deps);
    return {
      items: [],
      skipped,
      totalTravelMin: 0,
      endAt: input.startTime,
      geometry: null,
      travelMatrixId: empty.travelMatrixId,
      estimated: false,
    };
  }

  const matrixResult = await getTravelMatrix(repo, points, input.mode, deps);
  const output = planRoute({
    spots,
    originKey,
    destinationKey,
    date: input.date,
    startMin: hhmmToMinutes(input.startTime),
    endMin: hhmmToMinutes(input.endTime),
    pace: input.pace,
    interests: input.interests,
    lunchBreak: input.lunchBreak,
    matrix: matrixResult.matrix,
  });

  let geometry: PlanResult["geometry"] = null;
  let geometryEstimated = false;
  if (hasSpotItem(output.items)) {
    const coords = orderedCoordinates(input, output.items, spots);
    const g = await getRouteGeometry(repo, coords, input.mode, deps);
    geometry = g.geometry;
    geometryEstimated = g.estimated;
  }

  return {
    items: output.items,
    skipped: [...skipped, ...output.skipped],
    totalTravelMin: output.totalTravelMin,
    endAt: output.endAt,
    geometry,
    travelMatrixId: matrixResult.travelMatrixId,
    estimated: matrixResult.estimated || geometryEstimated,
  };
}

/**
 * 連続する区間（出発地 → 順番どおりのスポット → 到着地）の移動時間をキャッシュから引き、
 * 無い区間は直線距離の概算で埋める。外部 API は呼ばない。
 */
async function legsFromCacheOrEstimate(
  repo: Pick<Repository, "travelCache">,
  keys: readonly string[],
  coords: readonly LatLng[],
  mode: TravelMode,
): Promise<{ matrix: TravelMatrix; estimated: boolean }> {
  const pairs: { fromKey: string; toKey: string }[] = [];
  for (let i = 1; i < keys.length; i += 1) {
    if (keys[i - 1] !== keys[i]) pairs.push({ fromKey: keys[i - 1], toKey: keys[i] });
  }
  const cached = pairs.length ? await repo.travelCache.getMany(pairs, mode) : new Map();
  const matrix: TravelMatrix = new Map();
  let estimated = false;
  for (let i = 1; i < keys.length; i += 1) {
    if (keys[i - 1] === keys[i]) continue;
    const k = `${keys[i - 1]}|${keys[i]}`;
    const e = cached.get(k);
    if (e) {
      matrix.set(k, { durationSec: e.durationSec, distanceM: e.distanceM });
    } else {
      matrix.set(k, estimateTravel(coords[i - 1], coords[i], mode));
      estimated = true;
    }
  }
  return { matrix, estimated };
}

/**
 * POST /plans/recompute（F-5-6）：外部 API を呼ばない。
 * order の順にスポットを並べ、stayOverrides を適用して時刻を再計算する。
 * 終了時刻の超過はそのまま返す（items は必ず返し、画面は endAt で判断する）。
 * params.spotIds にあって order に無いスポットは time_limit として skipped に残す。
 */
export async function recomputePlan(
  repo: PlanComputeDeps,
  userId: string,
  input: PlanRecomputeInput,
): Promise<PlanResult> {
  const { params } = input;
  const list = await getOwnedWishlist(repo, userId, params.listId);
  const spotIds = unique(params.spotIds);
  assertSpotsInList(list, spotIds);
  const order = unique(input.order);
  const allowed = new Set(spotIds);
  const notAllowed = order.filter((id) => !allowed.has(id));
  if (notAllowed.length > 0) {
    throw ApiError.validation(
      ORDER_NOT_IN_SPOTS_MESSAGE,
      notAllowed.map((id) => ({ field: "order", reason: "not_in_spots", spotId: id })),
    );
  }

  const resolved = await resolvePlannerSpots(repo, list, order);
  const skipped: PlanResult["skipped"] = [...resolved.skipped];
  const inOrder = new Set(order);
  for (const id of spotIds) if (!inOrder.has(id)) skipped.push({ spotId: id, reason: "time_limit" });

  const originKey = coordKey(params.origin);
  const destinationKey = params.destination ? coordKey(params.destination) : null;
  const keys = [originKey, ...resolved.spots.map((s) => spotKey(s.id))];
  const coords: LatLng[] = [
    { lat: params.origin.lat, lng: params.origin.lng },
    ...resolved.spots.map((s) => ({ lat: s.lat, lng: s.lng })),
  ];
  if (params.destination) {
    keys.push(destinationKey!);
    coords.push({ lat: params.destination.lat, lng: params.destination.lng });
  }
  const { matrix, estimated } = await legsFromCacheOrEstimate(repo, keys, coords, params.mode);

  const schedule = buildSchedule(resolved.spots, {
    startMin: hhmmToMinutes(params.startTime),
    endMin: hhmmToMinutes(params.endTime),
    originKey,
    destinationKey,
    lunchBreak: params.lunchBreak,
    date: params.date,
    stayOverrides: input.stayOverrides,
    matrix,
    interests: params.interests,
    pace: params.pace,
  });

  return {
    items: schedule.items,
    skipped,
    totalTravelMin: schedule.totalTravelMin,
    endAt: minutesToHHMM(schedule.endMin),
    geometry: hasSpotItem(schedule.items) ? straightLine(coords) : null,
    travelMatrixId: input.travelMatrixId,
    estimated,
  };
}

/** POST /plans（F-5-7）：リストは本人のもの */
export async function savePlan(repo: PlanStoreDeps, userId: string, input: PlanSaveInput): Promise<Plan> {
  const list = await getOwnedWishlist(repo, userId, input.params.listId);
  const params: PlanParams = { ...input.params, spotIds: unique(input.params.spotIds) };
  const result: PlanResult = {
    items: input.result.items as PlanItem[],
    skipped: input.result.skipped as PlanResult["skipped"],
    totalTravelMin: input.result.totalTravelMin,
    endAt: input.result.endAt,
    geometry: (input.result.geometry ?? null) as PlanResult["geometry"],
    travelMatrixId: input.result.travelMatrixId,
    estimated: input.result.estimated,
  };
  return repo.plans.create({ userId, wishlistId: list.id, params, result });
}

/** 本人のプランを取得する。無ければ 404、他人のものなら 403 */
export async function getOwnedPlan(
  repo: Pick<Repository, "plans">,
  userId: string,
  planId: string,
): Promise<Plan> {
  const plan = await repo.plans.getById(planId);
  if (!plan) throw ApiError.notFound(PLAN_NOT_FOUND_MESSAGE);
  if (plan.userId !== userId) throw ApiError.forbidden();
  return plan;
}

/** GET /plans/{planId} */
export async function getPlan(
  repo: Pick<Repository, "plans">,
  userId: string,
  planId: string,
): Promise<Plan> {
  return getOwnedPlan(repo, userId, planId);
}

/** DELETE /plans/{planId}（F-5-7） */
export async function deletePlan(
  repo: Pick<Repository, "plans">,
  userId: string,
  planId: string,
): Promise<void> {
  await getOwnedPlan(repo, userId, planId);
  await repo.plans.delete(planId);
}
