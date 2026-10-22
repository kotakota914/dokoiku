/**
 * 経路プラン API の業務ロジック（F-5 / 11章 / ADR-0021〜0023）。
 * Route Handler は「認証 → レート制限 → 入力検証 → ここを呼ぶ → レスポンス」だけを行う。
 * - compute  : 移動時間の行列を用意し（外部 API は最大 1 回）、全探索で最大 3 案を返す。停止中は 503。
 * - recompute: 外部 API を呼ばない。移動時間はキャッシュ、無い区間は概算で埋める。
 * - chat     : Gemini で会話を条件（PlanPreferences）に変換する。会話は保存せず、本文をログに残さない。
 * - get      : 保存済みプランに各区間の「ナビを開始」用の Google マップ URL を付ける。
 * Repository の契約（src/lib/repo/types.ts）だけに依存する。
 */
import { ApiError } from "@/lib/api/errors";
import { checkRateLimit } from "@/lib/api/ratelimit";
import { serverConfig } from "@/lib/config";
import { GOOGLE_TRAVEL_MODE, LIMITS, type Feature, type TravelMode } from "@/lib/domain/constants";
import type {
  LatLng,
  Plan,
  PlanChatResponse,
  PlanComputeResponse,
  PlanItem,
  PlanNavSegment,
  PlanParams,
  PlanPreferences,
  PlanResult,
  PlanWithNav,
  SkipReason,
  WishlistDetail,
} from "@/lib/domain/types";
import { straightLine } from "@/lib/external/fallback";
import { generatePlanConditions, type GeminiChatInput } from "@/lib/external/gemini";
import { mockEnabled, mockGeminiResponse } from "@/lib/external/mock";
import { getLegsOffline, getTravelMatrix, type TravelDeps, type TravelPoint } from "@/lib/external/travel";
import { checkAndCount, isSuspended, suspendedMessage } from "@/lib/external/usage";
import { buildSchedule, notesFor, planRoute, type PlannerSpot } from "@/lib/planner";
import type { Repository } from "@/lib/repo/types";
import { coordKey, spotKey } from "@/lib/utils/geo";
import { hhmmToMinutes, minutesToHHMM } from "@/lib/utils/time";
import {
  planPreferencesSchema,
  timeHHMMSchema,
  type PlanChatInput,
  type PlanComputeInput,
  type PlanRecomputeInput,
  type PlanSaveInput,
} from "@/lib/validation/schemas";
import { getOwnedWishlist } from "./lists";

export const PLAN_NOT_FOUND_MESSAGE = "プランが見つかりませんでした";
export const SPOT_NOT_IN_LIST_MESSAGE = "リストに入っていないスポットが含まれています";
export const ORDER_NOT_IN_SPOTS_MESSAGE = "対象に含まれないスポットが並び順に含まれています";
export const PLAN_OVER_END_TIME_MESSAGE =
  "終了時刻を過ぎているため保存できません。順番や滞在時間を見直してください";
export const ITEM_NOT_IN_SPOTS_MESSAGE = "対象に含まれないスポットがプランに含まれています";
export const PLAN_RATE_LIMIT_MESSAGE = `経路の作成は1分に${LIMITS.plansPerMinute}回までです。少し待ってからもう一度お試しください`;
export const CHAT_RATE_LIMIT_MESSAGE = `AIとの相談は1分に${LIMITS.chatPerMinute}回までです。少し待ってからもう一度お試しください`;
export const CHAT_UNCLEAR_MESSAGE = "うまく読み取れませんでした。もう少し具体的に教えてください";
export const AI_UNAVAILABLE_MESSAGE = "現在、AIと相談は利用できません";
export const RECOMPUTE_LABEL = "調整した案";

type PlanComputeDeps = Pick<Repository, "wishlists" | "spots" | "travelCache" | "apiUsage">;
type PlanRecomputeDeps = Pick<Repository, "wishlists" | "spots" | "travelCache">;
type PlanChatDeps = Pick<Repository, "wishlists" | "spots" | "apiUsage">;
type PlanStoreDeps = Pick<Repository, "wishlists" | "plans">;

/** テストで外部 API の有無・取得・時刻を差し替える（travel.ts と同じ） */
export type PlanDeps = TravelDeps;

export interface ChatDeps {
  now?: Date;
  /** テストで Gemini の有無を固定する。省略時は GEMINI_API_KEY の有無 */
  aiEnabled?: boolean;
  /** F-8-8：記録済みの応答を返す。省略時は EXTERNAL_API_MOCK */
  mock?: boolean;
  /** テストで Gemini 呼び出しを差し替える（戻り値は検証前の JSON） */
  generate?: (input: GeminiChatInput) => Promise<unknown>;
}

// ---------- レート制限（9.1） ----------

/** POST /plans/compute：1 分に LIMITS.plansPerMinute 回（キーはユーザー ID）。超過は 429 */
export function assertPlanRateLimit(userId: string, now = new Date()): void {
  if (!checkRateLimit(`plans:compute:${userId}`, LIMITS.plansPerMinute, 60_000, now.getTime())) {
    throw ApiError.rateLimited(PLAN_RATE_LIMIT_MESSAGE);
  }
}

/** POST /plans/chat：1 分に LIMITS.chatPerMinute 回（キーはユーザー ID）。超過は 429 */
export function assertChatRateLimit(userId: string, now = new Date()): void {
  if (!checkRateLimit(`plans:chat:${userId}`, LIMITS.chatPerMinute, 60_000, now.getTime())) {
    throw ApiError.rateLimited(CHAT_RATE_LIMIT_MESSAGE);
  }
}

// ---------- 共通 ----------

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

/** 移動手段ごとの停止対象の機能（ADR-0022） */
export function featureForMode(mode: TravelMode): Feature {
  return mode === "transit" ? "route_planning_transit" : "route_planning";
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

function originPoint(params: Pick<PlanParams, "origin">): TravelPoint {
  return { key: coordKey(params.origin), lat: params.origin.lat, lng: params.origin.lng };
}

function destinationPoint(params: Pick<PlanParams, "destination">): TravelPoint | null {
  const d = params.destination;
  return d ? { key: coordKey(d), lat: d.lat, lng: d.lng } : null;
}

function spotPoint(s: PlannerSpot): TravelPoint {
  return { key: spotKey(s.id), lat: s.lat, lng: s.lng };
}

/** 保存する出発地・到着地の座標の桁数（小数 3 桁 ≒ 100m）。利用者の現在地をそのまま残さない（13章） */
export const SAVED_PLACE_DECIMALS = 3;

export function roundCoordinate(value: number): number {
  return Number(value.toFixed(SAVED_PLACE_DECIMALS));
}

function roundPlace<T extends LatLng>(place: T): T {
  return { ...place, lat: roundCoordinate(place.lat), lng: roundCoordinate(place.lng) };
}

/**
 * 保存するプランの出発地・到着地を約 100m に丸める（api-04）。
 * 出発地が「現在地」かどうかはサーバーでは判別できないため、すべての出発地・到着地に適用する。
 * 経路線の先頭（出発地）と、到着地があれば末尾の点も同じ精度に丸める。
 */
export function coarsenSavedPlan(
  params: PlanParams,
  result: PlanResult,
): { params: PlanParams; result: PlanResult } {
  const coarse: PlanParams = {
    ...params,
    origin: roundPlace(params.origin),
    destination: params.destination ? roundPlace(params.destination) : null,
  };
  if (!result.geometry || result.geometry.coordinates.length === 0) return { params: coarse, result };
  const coordinates = result.geometry.coordinates.map((c) => [...c] as [number, number]);
  const roundPoint = (i: number) => {
    coordinates[i] = [roundCoordinate(coordinates[i][0]), roundCoordinate(coordinates[i][1])];
  };
  roundPoint(0);
  if (params.destination) roundPoint(coordinates.length - 1);
  return { params: coarse, result: { ...result, geometry: { ...result.geometry, coordinates } } };
}

// ---------- POST /plans/compute ----------

/**
 * POST /plans/compute（F-5-3〜F-5-9）
 * 1. 移動手段の機能が停止中（F-8）なら 503。リストは本人のもの。spotIds はすべてリストに入っていること（400）。
 * 2. 削除済みスポットは deleted、除外指定は excluded として外す（行列にも入れない）。
 * 3. 移動時間の行列（キャッシュ → 欠けがあれば外部 1 回、使えなければ概算）。
 * 4. 全探索で最大 3 案。1 つも入らなければ candidates は空（200）。
 */
export async function computePlan(
  repo: PlanComputeDeps,
  userId: string,
  input: PlanComputeInput,
  deps: PlanDeps = {},
): Promise<PlanComputeResponse> {
  const now = deps.now ?? new Date();
  const feature = featureForMode(input.mode);
  if (await isSuspended(repo.apiUsage, feature, now)) {
    throw ApiError.suspended(feature, suspendedMessage(feature));
  }
  const list = await getOwnedWishlist(repo, userId, input.listId);
  const spotIds = unique(input.spotIds);
  assertSpotsInList(list, spotIds);

  const { spots, skipped: deleted } = await resolvePlannerSpots(repo, list, spotIds);
  const exclude = new Set(input.preferences.exclude);
  const active = spots.filter((s) => !exclude.has(s.id));
  const origin = originPoint(input);
  const destination = destinationPoint(input);
  const query = { mode: input.mode, date: input.date, startTime: input.startTime };

  // 対象が残らなければ外部 API を呼ばない
  const points: TravelPoint[] =
    active.length === 0
      ? [origin]
      : [origin, ...active.map(spotPoint), ...(destination ? [destination] : [])];
  const matrixResult = await getTravelMatrix(repo, points, query, { ...deps, now });

  const output = planRoute({
    spots,
    originKey: origin.key,
    destinationKey: destination?.key ?? null,
    origin: input.origin,
    destination: input.destination,
    date: input.date,
    startMin: hhmmToMinutes(input.startTime),
    endMin: hhmmToMinutes(input.endTime),
    mode: input.mode,
    preferences: input.preferences,
    lunchBreak: input.lunchBreak,
    matrix: matrixResult.matrix,
  });
  const skipped = [...deleted, ...output.skipped];
  return {
    candidates: output.candidates.map((c) => ({ ...c, skipped: [...deleted, ...c.skipped] })),
    travelMatrixId: matrixResult.travelMatrixId,
    skipped,
  };
}

// ---------- POST /plans/recompute ----------

/**
 * POST /plans/recompute（F-5-10）：外部 API を呼ばない。
 * order の順にスポットを並べ、stayOverrides を適用して時刻を再計算する（移動時間はキャッシュ、無い区間は概算）。
 * 終了時刻の超過はそのまま返し、注意書きを付ける（items は必ず返し、画面は endAt で判断する）。
 * params.spotIds にあって order に無いスポットは、除外指定なら excluded、それ以外は time_limit として skipped に残す。
 * kind / label / id は input.candidate を引き継ぐ（無ければ c1 / fewest_moves /「調整した案」）。
 */
export async function recomputePlan(
  repo: PlanRecomputeDeps,
  userId: string,
  input: PlanRecomputeInput,
  deps: Pick<PlanDeps, "mock"> = {},
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
  const exclude = new Set(params.preferences.exclude);
  for (const id of spotIds) {
    if (!inOrder.has(id)) skipped.push({ spotId: id, reason: exclude.has(id) ? "excluded" : "time_limit" });
  }

  const origin = originPoint(params);
  const destination = destinationPoint(params);
  const sequence: TravelPoint[] = [
    origin,
    ...resolved.spots.map(spotPoint),
    ...(destination ? [destination] : []),
  ];
  const matrix = await getLegsOffline(
    repo,
    sequence,
    { mode: params.mode, date: params.date, startTime: params.startTime },
    deps,
  );

  const endMin = hhmmToMinutes(params.endTime);
  const schedule = buildSchedule(resolved.spots, {
    startMin: hhmmToMinutes(params.startTime),
    endMin,
    originKey: origin.key,
    destinationKey: destination?.key ?? null,
    lunchBreak: params.lunchBreak,
    date: params.date,
    mode: params.mode,
    stayOverrides: input.stayOverrides,
    matrix,
    preferences: params.preferences,
  });
  const notes = notesFor(schedule, params.mode);
  if (schedule.endMin > endMin) notes.push(`終了時刻（${params.endTime}）を過ぎています`);
  const spotCount = schedule.items.filter((i) => i.type === "spot").length;
  const endAt = minutesToHHMM(schedule.endMin);
  return {
    id: input.candidate?.id ?? "c1",
    kind: input.candidate?.kind ?? "fewest_moves",
    label: input.candidate?.label ?? RECOMPUTE_LABEL,
    reason: `順番と滞在時間を調整しました。移動は合計${schedule.totalTravelMin}分です`,
    items: schedule.items,
    skipped,
    notes,
    stats: {
      spotCount,
      totalTravelMin: schedule.totalTravelMin,
      walkM: Math.round(schedule.walkM),
      endAt,
      bestTimeHits: schedule.bestTimeHits,
    },
    geometry: spotCount > 0 ? straightLine(sequence) : null,
    totalTravelMin: schedule.totalTravelMin,
    endAt,
    travelMatrixId: input.travelMatrixId,
    estimated: schedule.estimated,
  };
}

// ---------- POST /plans/chat ----------

const DEFAULT_PREFERENCES: PlanPreferences = {
  pace: "normal",
  interests: [],
  priority: "fewer_moves",
  timeWindows: [],
  orderHints: [],
  exclude: [],
};

const EMOJI_RE =
  /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}]/gu;

/** 絵文字（\p{Extended_Pictographic} と結合用の文字）を除く */
export function stripEmoji(text: string): string {
  return text
    .replace(EMOJI_RE, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Gemini の返答（検証前の JSON）を PlanChatResponse にする。
 * - spotId がリスト外（allowed に無い）の時刻の指定・順番の希望・除外は取り除く。HH:MM でない時刻の指定も除く。
 * - planPreferencesSchema で検証し、失敗したら unclear: true と定型文（conditions は直前の条件）。
 * - reply の絵文字を除く。
 */
export function sanitizeChatResponse(
  raw: unknown,
  allowedSpotIds: ReadonlySet<string>,
  previous: PlanPreferences | undefined,
): PlanChatResponse {
  const fallback: PlanChatResponse = {
    reply: CHAT_UNCLEAR_MESSAGE,
    conditions: previous ?? DEFAULT_PREFERENCES,
    unclear: true,
  };
  if (!isRecord(raw) || !isRecord(raw.conditions) || typeof raw.reply !== "string") return fallback;
  const c = raw.conditions;
  const isHHMM = (v: unknown) => timeHHMMSchema.safeParse(v).success;
  const timeWindows = Array.isArray(c.timeWindows)
    ? c.timeWindows.filter(
        (w): w is Record<string, unknown> =>
          isRecord(w) &&
          allowedSpotIds.has(String(w.spotId)) &&
          isHHMM(w.from) &&
          isHHMM(w.to) &&
          String(w.from) < String(w.to),
      )
    : c.timeWindows;
  const orderHints = Array.isArray(c.orderHints)
    ? c.orderHints
        .filter((h): h is Record<string, unknown> => isRecord(h) && allowedSpotIds.has(String(h.spotId)))
        .filter(
          (h) =>
            (h.position !== "before" && h.position !== "after") || allowedSpotIds.has(String(h.relativeTo)),
        )
        .map((h) =>
          h.position === "before" || h.position === "after" ? h : { spotId: h.spotId, position: h.position },
        )
    : c.orderHints;
  const exclude = Array.isArray(c.exclude)
    ? c.exclude.filter((id) => allowedSpotIds.has(String(id)))
    : c.exclude;
  const parsed = planPreferencesSchema.safeParse({ ...c, timeWindows, orderHints, exclude });
  const reply = stripEmoji(raw.reply).slice(0, 500);
  if (!parsed.success || !reply) return fallback;
  const conditions: PlanPreferences = {
    ...parsed.data,
    interests: unique(parsed.data.interests),
    exclude: unique(parsed.data.exclude),
  };
  if (raw.unclear === true) return { reply, conditions, unclear: true };
  return { reply, conditions, unclear: false };
}

/**
 * POST /plans/chat（F-5-5 / ADR-0023）
 * 1. AI が停止中・キー未設定なら 503（feature: ai_chat）。リストは本人のもの。spotIds はリスト内。
 * 2. Gemini に送るのは会話・対象スポットの { id, name, category }・共通条件・直前の条件だけ（ユーザー名・メールは送らない）。
 * 3. 使用量は 1 回ずつ数える（gemini、日単位）。会話は保存しない。
 */
export async function chatPlan(
  repo: PlanChatDeps,
  userId: string,
  input: PlanChatInput,
  deps: ChatDeps = {},
): Promise<PlanChatResponse> {
  const now = deps.now ?? new Date();
  const mock = mockEnabled(deps.mock);
  const enabled = deps.aiEnabled ?? (mock || !!serverConfig.geminiApiKey);
  if (await isSuspended(repo.apiUsage, "ai_chat", now)) {
    throw ApiError.suspended("ai_chat", suspendedMessage("ai_chat"));
  }
  if (!enabled) throw ApiError.suspended("ai_chat", AI_UNAVAILABLE_MESSAGE);

  const list = await getOwnedWishlist(repo, userId, input.listId);
  const spotIds = unique(input.spotIds);
  assertSpotsInList(list, spotIds);
  const found = await repo.spots.getManyByIds(spotIds);
  const spots = found.map((s) => ({ id: s.id, name: s.name, category: s.category }));
  const allowed = new Set(spots.map((s) => s.id));

  await checkAndCount(repo.apiUsage, "gemini", 1, { now, mock });
  const request: GeminiChatInput = {
    messages: input.messages,
    spots,
    params: { date: input.date, startTime: input.startTime, endTime: input.endTime, mode: input.mode },
    previous: input.conditions ?? null,
  };
  const raw = mock
    ? mockGeminiResponse()
    : await (deps.generate ?? ((r: GeminiChatInput) => generatePlanConditions(r)))(request);
  return sanitizeChatResponse(raw, allowed, input.conditions);
}

// ---------- POST /plans ----------

/**
 * POST /plans（F-5-11）：リストは本人のもの。
 * result の形はスキーマ（planSaveSchema）で検証済み。ここでは items / skipped の spotId が params.spotIds に
 * 含まれること、同じスポットが 2 回入っていないことを確認する（違反は 400）。
 * params.method / preferences も保存する。出発地・到着地の座標は coarsenSavedPlan で約 100m に丸める（13章）。
 */
export async function savePlan(repo: PlanStoreDeps, userId: string, input: PlanSaveInput): Promise<Plan> {
  const list = await getOwnedWishlist(repo, userId, input.params.listId);
  const params: PlanParams = { ...input.params, spotIds: unique(input.params.spotIds) };
  const allowed = new Set(params.spotIds);
  const itemSpotIds = input.result.items.flatMap((i) => (i.type === "spot" ? [i.spotId] : []));
  const skippedSpotIds = input.result.skipped.map((s) => s.spotId);
  const notAllowed = unique([...itemSpotIds, ...skippedSpotIds].filter((id) => !allowed.has(id)));
  if (notAllowed.length > 0 || new Set(itemSpotIds).size !== itemSpotIds.length) {
    throw ApiError.validation(
      ITEM_NOT_IN_SPOTS_MESSAGE,
      notAllowed.map((id) => ({ field: "result.items", reason: "not_in_spots", spotId: id })),
    );
  }
  const r = input.result;
  // F-5 受け入れ基準「終了時刻を超える案が出ない」：並び替えで終了時刻を過ぎた案は保存させない
  if (hhmmToMinutes(r.endAt) > hhmmToMinutes(params.endTime)) {
    throw ApiError.validation(PLAN_OVER_END_TIME_MESSAGE, [
      { field: "result.endAt", reason: "over_end_time" },
    ]);
  }
  const result: PlanResult = {
    id: r.id,
    kind: r.kind,
    label: r.label,
    reason: r.reason,
    items: r.items as PlanItem[],
    skipped: r.skipped,
    notes: r.notes,
    stats: r.stats,
    geometry: r.geometry ?? null,
    totalTravelMin: r.totalTravelMin,
    endAt: r.endAt,
    travelMatrixId: r.travelMatrixId,
    estimated: r.estimated,
  };
  const coarse = coarsenSavedPlan(params, result);
  return repo.plans.create({ userId, wishlistId: list.id, params: coarse.params, result: coarse.result });
}

// ---------- GET / DELETE /plans/{planId} ----------

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

/** Google マップの道案内 URL（F-5-12。API キー不要・無料枠を消費しない） */
export function googleNavUrl(from: LatLng, to: LatLng, mode: TravelMode): string {
  return `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=${GOOGLE_TRAVEL_MODE[mode]}`;
}

/**
 * 保存済みプランの区間（出発地 → 1 番目、各スポット → 次、最後 → 到着地（あれば））。
 * - fromIndex / toIndex は items のインデックス。出発地は -1、到着地は items.length
 * - 昼食は区間に含めない（直前のスポットから次のスポットへ）
 * - 座標はスポットの現在の座標。見つからない（削除済み）スポットは区間から外す
 */
export function buildNavSegments(
  plan: Pick<Plan, "params" | "result">,
  spotsById: ReadonlyMap<string, LatLng & { name: string }>,
): PlanNavSegment[] {
  const { params, result } = plan;
  const points: (LatLng & { index: number; label: string })[] = [
    { lat: params.origin.lat, lng: params.origin.lng, index: -1, label: params.origin.label || "出発地" },
  ];
  result.items.forEach((item, index) => {
    if (item.type !== "spot") return;
    const s = spotsById.get(item.spotId);
    if (s) points.push({ lat: s.lat, lng: s.lng, index, label: s.name });
  });
  if (params.destination) {
    points.push({
      lat: params.destination.lat,
      lng: params.destination.lng,
      index: result.items.length,
      label: params.destination.label || "到着地",
    });
  }
  const segments: PlanNavSegment[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1];
    const to = points[i];
    segments.push({
      fromIndex: from.index,
      toIndex: to.index,
      fromLabel: from.label,
      toLabel: to.label,
      navUrl: googleNavUrl(from, to, params.mode),
    });
  }
  return segments;
}

/** GET /plans/{planId}：保存済みプラン＋各区間の「ナビを開始」用 URL */
export async function getPlan(
  repo: Pick<Repository, "plans" | "spots">,
  userId: string,
  planId: string,
): Promise<PlanWithNav> {
  const plan = await getOwnedPlan(repo, userId, planId);
  const ids = unique(plan.result.items.flatMap((i) => (i.type === "spot" ? [i.spotId] : [])));
  const spots = ids.length > 0 ? await repo.spots.getManyByIds(ids) : [];
  const byId = new Map(spots.map((s) => [s.id, { lat: s.lat, lng: s.lng, name: s.name }] as const));
  return { ...plan, segments: buildNavSegments(plan, byId) };
}

/** DELETE /plans/{planId}（F-5-11） */
export async function deletePlan(
  repo: Pick<Repository, "plans">,
  userId: string,
  planId: string,
): Promise<void> {
  await getOwnedPlan(repo, userId, planId);
  await repo.plans.delete(planId);
}
