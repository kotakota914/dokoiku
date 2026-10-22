/**
 * 経路プラン API の service のテスト（memory モード、seed あり）。
 * 外部 API（OpenRouteService / Google Routes / Gemini）は fetch か deps をモックし、実際のネットワークには出ない。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { resetRateLimits } from "@/lib/api/ratelimit";
import { USAGE_LIMITS } from "@/lib/domain/constants";
import type { PlanCandidate, PlanItem, PlanPreferences } from "@/lib/domain/types";
import { estimateTravel } from "@/lib/external/fallback";
import type { GeminiChatInput } from "@/lib/external/gemini";
import { GOOGLE_ROUTES_MATRIX_URL } from "@/lib/external/google-routes";
import { ORS_BASE_URL } from "@/lib/external/ors";
import { periodFor } from "@/lib/external/usage";
import { computeStayMinutes, NOTE_STRAIGHT_LINE, NOTE_TRANSIT_ESTIMATE } from "@/lib/planner";
import { createMemoryRepository, SEED_USER_IDS } from "@/lib/repo/memory";
import { seedUuid } from "@/lib/repo/memory/seed";
import { haversineM } from "@/lib/utils/geo";
import { hhmmToMinutes, minutesToHHMM, nowIso } from "@/lib/utils/time";
import {
  planChatSchema,
  planComputeSchema,
  planRecomputeSchema,
  planSaveSchema,
  type PlanComputeInput,
} from "@/lib/validation/schemas";
import { addWishlistItem, createWishlist, getOwnedWishlist, setWishlistItemMustVisit } from "./lists";
import {
  AI_UNAVAILABLE_MESSAGE,
  assertChatRateLimit,
  assertPlanRateLimit,
  buildNavSegments,
  chatPlan,
  CHAT_UNCLEAR_MESSAGE,
  coarsenSavedPlan,
  computePlan,
  deletePlan,
  getPlan,
  ITEM_NOT_IN_SPOTS_MESSAGE,
  RECOMPUTE_LABEL,
  recomputePlan,
  roundCoordinate,
  savePlan,
  SPOT_NOT_IN_LIST_MESSAGE,
  stripEmoji,
} from "./plans";

vi.mock("server-only", () => ({}));

const USER_A = SEED_USER_IDS.userA;
const USER_B = SEED_USER_IDS.userB;
/** 兼六園・金沢城公園・ひがし茶屋街（seed の 1〜3 番目） */
const SPOTS = [seedUuid("spot", 1), seedUuid("spot", 2), seedUuid("spot", 3)];
const KANAZAWA_STATION = { lat: 36.578, lng: 136.6478, label: "金沢駅" };
/** 2026-11-04 は水曜 */
const DATE = "2026-11-04";
/** 外部 API を使わない（直線距離の概算） */
const FALLBACK = { routingEnabled: false, transitEnabled: false, mock: false } as const;

let repo = createMemoryRepository(true, { persist: false });

async function expectApiError(p: Promise<unknown>, status: number, message?: string): Promise<ApiError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    const e = err as ApiError;
    expect(e.status).toBe(status);
    if (message) expect(e.message).toBe(message);
    return e;
  }
  throw new Error(`expected ApiError ${status} but resolved`);
}

async function listWith(userId: string, spotIds: string[]): Promise<string> {
  const list = await createWishlist(repo, userId, { name: "テスト" });
  for (const id of spotIds) await addWishlistItem(repo, userId, list.id, { spotId: id });
  return list.id;
}

function params(
  listId: string,
  overrides: Partial<Omit<PlanComputeInput, "preferences">> & { preferences?: Partial<PlanPreferences> } = {},
): PlanComputeInput {
  const { preferences, ...rest } = overrides;
  return planComputeSchema.parse({
    listId,
    spotIds: SPOTS,
    origin: KANAZAWA_STATION,
    destination: null,
    date: DATE,
    startTime: "09:00",
    endTime: "18:00",
    mode: "driving",
    lunchBreak: false,
    method: "preferences",
    preferences: { ...preferences },
    ...rest,
  });
}

type SpotItem = Extract<PlanItem, { type: "spot" }>;
function spotItems(items: PlanItem[]): SpotItem[] {
  return items.filter((i): i is SpotItem => i.type === "spot");
}

/** 候補を保存用の PlanResult にする（画面がすること） */
function toResult(c: PlanCandidate, travelMatrixId: string) {
  return {
    ...c,
    totalTravelMin: c.stats.totalTravelMin,
    endAt: c.stats.endAt,
    travelMatrixId,
    estimated: c.items.some((i) => i.next?.estimated),
  };
}

/** ORS と Google Routes の応答を真似る fetch（直線距離から） */
function externalFetchMock() {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (url.startsWith(`${ORS_BASE_URL}/v2/matrix/`)) {
      const pts = (body.locations as [number, number][]).map(([lng, lat]) => ({ lat, lng }));
      const distances = pts.map((a) => pts.map((b) => Math.round(haversineM(a, b))));
      const durations = distances.map((row) => row.map((d) => Math.round(d / 1.25)));
      return new Response(JSON.stringify({ durations, distances }), { status: 200 });
    }
    if (url === GOOGLE_ROUTES_MATRIX_URL) {
      type W = { waypoint: { location: { latLng: { latitude: number; longitude: number } } } };
      const toLatLng = (w: W) => ({
        lat: w.waypoint.location.latLng.latitude,
        lng: w.waypoint.location.latLng.longitude,
      });
      const origins = (body.origins as W[]).map(toLatLng);
      const dests = (body.destinations as W[]).map(toLatLng);
      const out = origins.flatMap((o, i) =>
        dests.map((d, j) => {
          const m = Math.round(haversineM(o, d));
          return {
            originIndex: i,
            destinationIndex: j,
            duration: `${Math.round(m / 3) + 300}s`,
            distanceMeters: m,
            condition: "ROUTE_EXISTS",
          };
        }),
      );
      return new Response(JSON.stringify(out), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

beforeEach(() => {
  repo = createMemoryRepository(true, { persist: false });
  resetRateLimits();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.ORS_API_KEY;
  delete process.env.GOOGLE_ROUTES_API_KEY;
});

describe("computePlan（外部 API 未設定：直線距離の概算）", () => {
  it("最大 3 案を返し、各案の時刻・next・stats・注意書き・線が妥当", async () => {
    const listId = await listWith(USER_A, SPOTS);
    const res = await computePlan(repo, USER_A, params(listId), FALLBACK);
    expect(res.travelMatrixId).toMatch(/^tm_driving_[0-9a-f]{16}$/);
    expect(res.skipped).toEqual([]);
    expect(res.candidates.length).toBeGreaterThanOrEqual(1);
    expect(res.candidates.length).toBeLessThanOrEqual(3);
    expect(res.candidates.map((c) => c.id)).toEqual(["c1", "c2", "c3"].slice(0, res.candidates.length));
    expect(res.candidates[0].kind).toBe("fewest_moves");

    for (const c of res.candidates) {
      const spots = spotItems(c.items);
      expect(new Set(spots.map((s) => s.spotId))).toEqual(new Set(SPOTS));
      let prev = hhmmToMinutes("09:00");
      for (const s of spots) {
        expect(hhmmToMinutes(s.arrive)).toBeGreaterThan(prev);
        expect(hhmmToMinutes(s.depart) - hhmmToMinutes(s.arrive)).toBe(s.stayMin);
        expect(s.travelMinToNext).toBe(s.next?.travelMin ?? null);
        prev = hhmmToMinutes(s.depart);
      }
      expect(spots[0].next).toMatchObject({ mode: "driving", estimated: true, walkM: 0 });
      expect(spots[2].next).toBeNull();
      expect(c.stats).toMatchObject({ spotCount: 3, endAt: spots[2].depart, walkM: 0 });
      expect(c.notes).toEqual([NOTE_STRAIGHT_LINE]);
      expect(c.reason.length).toBeGreaterThan(0);
      expect(c.geometry?.coordinates).toHaveLength(4);
      expect(c.geometry?.coordinates[0]).toEqual([KANAZAWA_STATION.lng, KANAZAWA_STATION.lat]);
    }
    // 最初の区間は出発地からの概算
    const c1 = spotItems(res.candidates[0].items);
    const first = (await repo.spots.getById(c1[0].spotId))!;
    const leg = estimateTravel(KANAZAWA_STATION, first, "driving");
    expect(hhmmToMinutes(c1[0].arrive)).toBe(hhmmToMinutes("09:00") + Math.ceil(leg.durationSec / 60));
  });

  it("到着地があれば最後に到着地への区間が入り、線は到着地まで", async () => {
    const listId = await listWith(USER_A, SPOTS);
    const res = await computePlan(repo, USER_A, params(listId, { destination: KANAZAWA_STATION }), FALLBACK);
    const c = res.candidates[0];
    const last = spotItems(c.items)[2];
    expect(last.next?.travelMin).toBeGreaterThan(0);
    expect(hhmmToMinutes(c.stats.endAt)).toBe(hhmmToMinutes(last.depart) + last.next!.travelMin);
    expect(c.geometry?.coordinates).toHaveLength(5);
  });

  it("終了時刻を短くすると入らないスポットが time_limit になり、必ず行きたいは残る", async () => {
    const listId = await listWith(USER_A, SPOTS);
    const must = SPOTS[2];
    await setWishlistItemMustVisit(repo, USER_A, listId, must, { mustVisit: true });
    const spot = (await repo.spots.getById(must))!;
    const travelMin = Math.ceil(estimateTravel(KANAZAWA_STATION, spot, "driving").durationSec / 60);
    const endTime = minutesToHHMM(
      hhmmToMinutes("09:00") + travelMin + computeStayMinutes(spot, [], "normal") + 5,
    );

    const res = await computePlan(repo, USER_A, params(listId, { endTime }), FALLBACK);
    expect(spotItems(res.candidates[0].items).map((s) => s.spotId)).toEqual([must]);
    expect(res.skipped).toHaveLength(2);
    expect(res.skipped!.every((s) => s.reason === "time_limit")).toBe(true);
    expect(res.candidates[0].skipped).toEqual(res.skipped);
    expect(hhmmToMinutes(res.candidates[0].stats.endAt)).toBeLessThanOrEqual(hhmmToMinutes(endTime));
  });

  it("必ず行きたいだけでも入らなければ candidates は空で、全スポットが time_limit", async () => {
    const listId = await listWith(USER_A, SPOTS);
    await setWishlistItemMustVisit(repo, USER_A, listId, SPOTS[2], { mustVisit: true });
    const res = await computePlan(repo, USER_A, params(listId, { endTime: "09:10" }), FALLBACK);
    expect(res.candidates).toEqual([]);
    expect(res.skipped?.map((s) => s.reason)).toEqual(["time_limit", "time_limit", "time_limit"]);
  });

  it("昼食休憩を入れると 60 分の lunch が入り、線はスポットだけを結ぶ", async () => {
    const listId = await listWith(USER_A, SPOTS);
    const res = await computePlan(repo, USER_A, params(listId, { lunchBreak: true }), FALLBACK);
    const c = res.candidates[0];
    const lunch = c.items.filter((i) => i.type === "lunch");
    expect(lunch).toHaveLength(1);
    expect(hhmmToMinutes(lunch[0].arrive)).toBeGreaterThanOrEqual(hhmmToMinutes("11:30"));
    expect(c.geometry?.coordinates).toHaveLength(4);
  });

  it("ペースと重視するものが滞在時間に反映される", async () => {
    const listId = await listWith(USER_A, SPOTS);
    const normal = await computePlan(repo, USER_A, params(listId), FALLBACK);
    const relaxed = await computePlan(
      repo,
      USER_A,
      params(listId, { preferences: { pace: "relaxed", interests: ["history"] } }),
      FALLBACK,
    );
    const stayOf = (c: PlanCandidate, id: string) => spotItems(c.items).find((s) => s.spotId === id)!.stayMin;
    for (const id of SPOTS) {
      const spot = (await repo.spots.getById(id))!;
      expect(stayOf(normal.candidates[0], id)).toBe(computeStayMinutes(spot, [], "normal"));
      expect(stayOf(relaxed.candidates[0], id)).toBe(computeStayMinutes(spot, ["history"], "relaxed"));
    }
  });

  it("投稿 0 件のスポットは deleted、除外指定は excluded で外す", async () => {
    const empty = await repo.spots.create({
      name: "投稿のないスポット",
      lat: 36.55,
      lng: 136.64,
      category: "other",
      source: "gps",
      createdBy: USER_A,
    });
    const ids = [SPOTS[0], SPOTS[1], empty.id];
    const listId = await listWith(USER_A, ids);
    const res = await computePlan(
      repo,
      USER_A,
      params(listId, { spotIds: ids, preferences: { exclude: [SPOTS[1]] } }),
      FALLBACK,
    );
    expect(res.skipped).toEqual([
      { spotId: empty.id, reason: "deleted" },
      { spotId: SPOTS[1], reason: "excluded" },
    ]);
    expect(spotItems(res.candidates[0].items).map((s) => s.spotId)).toEqual([SPOTS[0]]);
  });

  it("対象がすべて削除済みなら外部 API を呼ばず candidates は空", async () => {
    const empty = await repo.spots.create({
      name: "空",
      lat: 36.55,
      lng: 136.64,
      category: "other",
      source: "gps",
      createdBy: USER_A,
    });
    const listId = await listWith(USER_A, [empty.id]);
    const fetchMock = externalFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    process.env.ORS_API_KEY = "test-key";
    const res = await computePlan(repo, USER_A, params(listId, { spotIds: [empty.id] }), { mock: false });
    expect(res).toMatchObject({ candidates: [], skipped: [{ spotId: empty.id, reason: "deleted" }] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("公共交通でキーが無ければ 15km/h＋待ち 10 分の概算で、目安と概算の注意書きを付ける", async () => {
    const listId = await listWith(USER_A, SPOTS);
    const res = await computePlan(repo, USER_A, params(listId, { mode: "transit" }), FALLBACK);
    expect(res.travelMatrixId).toMatch(/^tm_transit_/);
    const c = res.candidates[0];
    expect(c.notes).toEqual([NOTE_TRANSIT_ESTIMATE, NOTE_STRAIGHT_LINE]);
    const first = spotItems(c.items)[0];
    expect(first.next).toMatchObject({ mode: "transit", estimated: true, walkM: null });
    const spot = (await repo.spots.getById(first.spotId))!;
    const leg = estimateTravel(KANAZAWA_STATION, spot, "transit");
    expect(hhmmToMinutes(first.arrive)).toBe(hhmmToMinutes("09:00") + Math.ceil(leg.durationSec / 60));
    expect(Math.ceil(leg.durationSec / 60)).toBeGreaterThanOrEqual(10);
  });
});

describe("computePlan（外部 API あり：fetch をモック）", () => {
  it("徒歩・車：ORS の行列 1 回だけ（経路の形は呼ばない）。2 回目はキャッシュで 0 回", async () => {
    const fetchMock = externalFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    process.env.ORS_API_KEY = "test-key";
    const listId = await listWith(USER_A, SPOTS);
    const res = await computePlan(repo, USER_A, params(listId), { mock: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${ORS_BASE_URL}/v2/matrix/driving-car`);
    expect(res.candidates[0].notes).toEqual([]);
    expect(await repo.apiUsage.get("ors", "route_planning", periodFor("ors_matrix"))).toMatchObject({
      count: 1,
    });

    const again = await computePlan(repo, USER_A, params(listId), { mock: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(again).toEqual(res);
  });

  it("公共交通：Google Routes を 1 回、組み合わせの件数で数え、2 回目はキャッシュで 0 回", async () => {
    const fetchMock = externalFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    process.env.GOOGLE_ROUTES_API_KEY = "g-key";
    const listId = await listWith(USER_A, SPOTS);
    const res = await computePlan(repo, USER_A, params(listId, { mode: "transit" }), { mock: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe("g-key");
    expect(JSON.parse(String(init.body))).toMatchObject({
      travelMode: "TRANSIT",
      departureTime: "2026-11-04T09:00:00+09:00",
    });
    const { provider, feature } = USAGE_LIMITS.google_routes_transit;
    // 出発地＋3 か所 = 4 地点 → 4×4 − 4 = 12 件
    expect(await repo.apiUsage.get(provider, feature, periodFor("google_routes_transit"))).toMatchObject({
      count: 12,
    });
    const c = res.candidates[0];
    expect(c.notes).toEqual([NOTE_TRANSIT_ESTIMATE]);
    expect(spotItems(c.items)[0].next).toMatchObject({ mode: "transit", estimated: false });

    await computePlan(repo, USER_A, params(listId, { mode: "transit" }), { mock: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // 休日は別の区分なので取り直す（キャッシュに無い組み合わせだけ）
    await computePlan(repo, USER_A, params(listId, { mode: "transit", date: "2026-11-07" }), { mock: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("モック（F-8-8）では fetch も使用量も使わない", async () => {
    const fetchMock = externalFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    process.env.GOOGLE_ROUTES_API_KEY = "g-key";
    const listId = await listWith(USER_A, SPOTS);
    const res = await computePlan(repo, USER_A, params(listId, { mode: "transit" }), { mock: true });
    expect(res.candidates.length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
    const { provider, feature } = USAGE_LIMITS.google_routes_transit;
    expect(await repo.apiUsage.get(provider, feature, periodFor("google_routes_transit"))).toBeNull();
  });
});

describe("computePlan（権限・入力・停止中）", () => {
  it("他人のリストは 403、存在しないリストは 404、リストに無いスポットは 400", async () => {
    const listId = await listWith(USER_A, SPOTS);
    await expectApiError(computePlan(repo, USER_B, params(listId), FALLBACK), 403);
    await expectApiError(
      computePlan(repo, USER_A, params("b0000000-0000-4000-8000-ffffffffffff"), FALLBACK),
      404,
    );
    const partial = await listWith(USER_A, [SPOTS[0], SPOTS[1]]);
    const err = await expectApiError(
      computePlan(repo, USER_A, params(partial), FALLBACK),
      400,
      SPOT_NOT_IN_LIST_MESSAGE,
    );
    expect(err.details).toEqual([{ field: "spotIds", reason: "not_in_list", spotId: SPOTS[2] }]);
  });

  it("9 か所目はスキーマで 400", () => {
    const ids = Array.from({ length: 9 }, (_, i) => seedUuid("spot", i + 1));
    expect(
      planComputeSchema.safeParse({ ...params("b0000000-0000-4000-8000-0000000000aa"), spotIds: ids })
        .success,
    ).toBe(false);
  });

  it("移動手段ごとに停止中なら 503（details.feature）。公共交通の停止は徒歩・車に影響しない", async () => {
    const listId = await listWith(USER_A, SPOTS);
    const t = USAGE_LIMITS.google_routes_transit;
    const period = periodFor("google_routes_transit");
    await repo.apiUsage.increment(t.provider, t.feature, period, t.limit, t.limit);
    await repo.apiUsage.setSuspended(t.provider, t.feature, period, nowIso());
    const err = await expectApiError(
      computePlan(repo, USER_A, params(listId, { mode: "transit" }), FALLBACK),
      503,
    );
    expect(err).toMatchObject({ code: "FEATURE_SUSPENDED", details: { feature: "route_planning_transit" } });
    await expect(
      computePlan(repo, USER_A, params(listId, { mode: "walking" }), FALLBACK),
    ).resolves.toBeTruthy();

    const o = USAGE_LIMITS.ors_matrix;
    const day = periodFor("ors_matrix");
    await repo.apiUsage.increment(o.provider, o.feature, day, o.limit, o.limit);
    await repo.apiUsage.setSuspended(o.provider, o.feature, day, nowIso());
    const err2 = await expectApiError(computePlan(repo, USER_A, params(listId), FALLBACK), 503);
    expect(err2.details).toEqual({ feature: "route_planning" });
  });
});

describe("レート制限（9.1）", () => {
  it("経路作成は 1 分に 3 回、AIとの相談は 1 分に 5 回まで（429）。1 分たてば戻る", () => {
    const now = new Date("2026-11-04T00:00:00Z");
    for (let i = 0; i < 3; i += 1) assertPlanRateLimit(USER_A, now);
    expect(() => assertPlanRateLimit(USER_A, now)).toThrowError(
      expect.objectContaining({ code: "RATE_LIMITED", status: 429 }),
    );
    // 別のユーザーは別に数える
    expect(() => assertPlanRateLimit(USER_B, now)).not.toThrow();
    expect(() => assertPlanRateLimit(USER_A, new Date(now.getTime() + 60_000))).not.toThrow();

    for (let i = 0; i < 5; i += 1) assertChatRateLimit(USER_A, now);
    expect(() => assertChatRateLimit(USER_A, now)).toThrowError(
      expect.objectContaining({ code: "RATE_LIMITED" }),
    );
  });
});

describe("recomputePlan（F-5-10：外部 API を呼ばない）", () => {
  it("order の順に並べ、stayOverrides を反映し、候補の id / kind / label を引き継ぐ", async () => {
    const fetchMock = externalFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    process.env.ORS_API_KEY = "test-key";
    const listId = await listWith(USER_A, SPOTS);
    const order = [SPOTS[2], SPOTS[0], SPOTS[1]];
    const input = planRecomputeSchema.parse({
      params: params(listId, { destination: KANAZAWA_STATION }),
      travelMatrixId: "tm_driving_0123456789abcdef",
      order,
      stayOverrides: { [SPOTS[0]]: 15 },
      candidate: { id: "c2", kind: "best_time", label: "おすすめの時間帯に最も合う案" },
    });
    const r = await recomputePlan(repo, USER_A, input, { mock: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r).toMatchObject({ id: "c2", kind: "best_time", label: "おすすめの時間帯に最も合う案" });
    const spots = spotItems(r.items);
    expect(spots.map((s) => s.spotId)).toEqual(order);
    expect(spots[1].stayMin).toBe(15);
    expect(r.skipped).toEqual([]);
    expect(r.travelMatrixId).toBe("tm_driving_0123456789abcdef");
    expect(r.estimated).toBe(true);
    expect(r.notes).toEqual([NOTE_STRAIGHT_LINE]);
    expect(r.geometry?.coordinates).toHaveLength(5);
    expect(r.endAt).toBe(r.stats.endAt);
    expect(r.totalTravelMin).toBe(r.stats.totalTravelMin);
    expect(hhmmToMinutes(r.endAt)).toBe(hhmmToMinutes(spots[2].depart) + spots[2].next!.travelMin);
  });

  it("候補が無ければ c1 / fewest_moves /「調整した案」。終了時刻を超えても items を返し注意書きを付ける", async () => {
    const listId = await listWith(USER_A, SPOTS);
    const input = planRecomputeSchema.parse({
      params: params(listId, { endTime: "10:00" }),
      travelMatrixId: "tm_x",
      order: SPOTS,
    });
    const r = await recomputePlan(repo, USER_A, input, { mock: false });
    expect(r).toMatchObject({ id: "c1", kind: "fewest_moves", label: RECOMPUTE_LABEL });
    expect(spotItems(r.items)).toHaveLength(3);
    expect(hhmmToMinutes(r.endAt)).toBeGreaterThan(hhmmToMinutes("10:00"));
    expect(r.notes).toContain("終了時刻（10:00）を過ぎています");
  });

  it("compute 後のキャッシュを使い、order に無いスポットは time_limit（除外指定なら excluded）", async () => {
    const fetchMock = externalFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    process.env.GOOGLE_ROUTES_API_KEY = "g-key";
    const listId = await listWith(USER_A, SPOTS);
    const p = params(listId, { mode: "transit", preferences: { exclude: [SPOTS[2]] } });
    const computed = await computePlan(repo, USER_A, p, { mock: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const r = await recomputePlan(
      repo,
      USER_A,
      planRecomputeSchema.parse({ params: p, travelMatrixId: computed.travelMatrixId, order: [SPOTS[1]] }),
      { mock: false },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.estimated).toBe(false);
    expect(r.notes).toEqual([NOTE_TRANSIT_ESTIMATE]);
    expect(r.skipped).toEqual([
      { spotId: SPOTS[0], reason: "time_limit" },
      { spotId: SPOTS[2], reason: "excluded" },
    ]);
  });

  it("他人のリストは 403、spotIds に無いスポットが order にあれば 400", async () => {
    const listId = await listWith(USER_A, SPOTS);
    const base = { params: params(listId, { spotIds: [SPOTS[0], SPOTS[1]] }), travelMatrixId: "tm_x" };
    await expectApiError(
      recomputePlan(repo, USER_B, planRecomputeSchema.parse({ ...base, order: [SPOTS[0]] })),
      403,
    );
    const err = await expectApiError(
      recomputePlan(repo, USER_A, planRecomputeSchema.parse({ ...base, order: [SPOTS[2]] })),
      400,
    );
    expect(err.code).toBe("VALIDATION_ERROR");
  });
});

describe("chatPlan（F-5-5 / ADR-0023）", () => {
  function chatInput(listId: string, extra: Record<string, unknown> = {}) {
    return planChatSchema.parse({
      listId,
      spotIds: SPOTS,
      date: DATE,
      startTime: "09:00",
      endTime: "18:00",
      mode: "transit",
      messages: [{ role: "user", content: "金沢城公園には午前中に行きたい。ひがし茶屋街は最後で" }],
      ...extra,
    });
  }

  it("AI が未設定・停止中なら 503（feature: ai_chat）", async () => {
    const listId = await listWith(USER_A, SPOTS);
    const off = await expectApiError(
      chatPlan(repo, USER_A, chatInput(listId), { aiEnabled: false, mock: false }),
      503,
      AI_UNAVAILABLE_MESSAGE,
    );
    expect(off.details).toEqual({ feature: "ai_chat" });
    const g = USAGE_LIMITS.gemini;
    const period = periodFor("gemini");
    await repo.apiUsage.increment(g.provider, g.feature, period, g.limit, g.limit);
    await repo.apiUsage.setSuspended(g.provider, g.feature, period, nowIso());
    const generate = vi.fn();
    const err = await expectApiError(
      chatPlan(repo, USER_A, chatInput(listId), { aiEnabled: true, mock: false, generate }),
      503,
    );
    expect(err.details).toEqual({ feature: "ai_chat" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("送るのは会話・スポットの id / 名前 / カテゴリ・共通条件だけ。リスト外の spotId と絵文字を除き、1 回数える", async () => {
    const listId = await listWith(USER_A, SPOTS);
    const foreign = "b0000000-0000-4000-8000-ffffffffffff";
    const generate = vi.fn<(input: GeminiChatInput) => Promise<unknown>>(async () => ({
      reply: "金沢城公園は午前に、ひがし茶屋街は最後にします\u{1F600}",
      conditions: {
        pace: "normal",
        interests: ["history", "history"],
        priority: "best_time",
        timeWindows: [
          { spotId: SPOTS[1], from: "09:00", to: "12:00" },
          { spotId: foreign, from: "10:00", to: "11:00" },
          { spotId: SPOTS[0], from: "9時", to: "10:00" },
        ],
        orderHints: [
          { spotId: SPOTS[2], position: "last" },
          { spotId: SPOTS[0], position: "before", relativeTo: foreign },
        ],
        exclude: [foreign],
      },
      unclear: false,
    }));
    const res = await chatPlan(repo, USER_A, chatInput(listId), { aiEnabled: true, mock: false, generate });
    expect(res).toEqual({
      reply: "金沢城公園は午前に、ひがし茶屋街は最後にします",
      conditions: {
        pace: "normal",
        interests: ["history"],
        priority: "best_time",
        timeWindows: [{ spotId: SPOTS[1], from: "09:00", to: "12:00" }],
        orderHints: [{ spotId: SPOTS[2], position: "last" }],
        exclude: [],
      },
      unclear: false,
    });
    const sent = generate.mock.calls[0][0];
    expect(Object.keys(sent).sort()).toEqual(["messages", "params", "previous", "spots"]);
    expect(sent.spots.map((s) => Object.keys(s).sort())).toEqual(SPOTS.map(() => ["category", "id", "name"]));
    expect(sent.params).toEqual({ date: DATE, startTime: "09:00", endTime: "18:00", mode: "transit" });
    expect(JSON.stringify(sent)).not.toContain(USER_A);
    const g = USAGE_LIMITS.gemini;
    expect(await repo.apiUsage.get(g.provider, g.feature, periodFor("gemini"))).toMatchObject({ count: 1 });
  });

  it("形の崩れた返答は unclear: true と定型文（条件は直前のもの）。AI が unclear なら引き継ぐ", async () => {
    const listId = await listWith(USER_A, SPOTS);
    const previous = {
      pace: "packed",
      interests: [],
      priority: "more_spots",
      timeWindows: [],
      orderHints: [],
      exclude: [],
    };
    const broken = await chatPlan(repo, USER_A, chatInput(listId, { conditions: previous }), {
      aiEnabled: true,
      mock: false,
      generate: async () => ({ reply: "x", conditions: { pace: "fast" } }),
    });
    expect(broken).toEqual({ reply: CHAT_UNCLEAR_MESSAGE, conditions: previous, unclear: true });
    const unclear = await chatPlan(repo, USER_A, chatInput(listId), {
      aiEnabled: true,
      mock: false,
      generate: async () => ({
        reply: "どのスポットを優先しますか",
        conditions: {
          pace: "normal",
          interests: [],
          priority: "fewer_moves",
          timeWindows: [],
          orderHints: [],
          exclude: [],
        },
        unclear: true,
      }),
    });
    expect(unclear).toMatchObject({ reply: "どのスポットを優先しますか", unclear: true });
  });

  it("モックでは固定応答を返し、回数を数えない。他人のリストは 403", async () => {
    const listId = await listWith(USER_A, SPOTS);
    const res = await chatPlan(repo, USER_A, chatInput(listId), { mock: true });
    expect(typeof res.reply).toBe("string");
    expect(res.unclear).toBe(false);
    const g = USAGE_LIMITS.gemini;
    expect(await repo.apiUsage.get(g.provider, g.feature, periodFor("gemini"))).toBeNull();
    await expectApiError(chatPlan(repo, USER_B, chatInput(listId), { mock: true }), 403);
  });

  it("stripEmoji は絵文字と結合用の文字を除く", () => {
    expect(stripEmoji("楽しみ\u{1F389}です❤️！")).toBe("楽しみです！");
    expect(stripEmoji("\u{1F468}‍\u{1F469}‍\u{1F467}家族で")).toBe("家族で");
  });
});

describe("savePlan / getPlan / deletePlan（F-5-11 / F-5-12）", () => {
  it("保存したプランは method も残り、本人だけが取得・削除できる。各区間にナビ URL が付く", async () => {
    const listId = await listWith(USER_A, SPOTS);
    const p = params(listId, { mode: "transit", lunchBreak: true, destination: KANAZAWA_STATION });
    const res = await computePlan(repo, USER_A, p, FALLBACK);
    const result = toResult(res.candidates[0], res.travelMatrixId);
    const plan = await savePlan(repo, USER_A, planSaveSchema.parse({ params: p, result }));
    expect(plan.params.method).toBe("preferences");
    expect(plan.params.preferences).toEqual(p.preferences);
    expect(plan.result).toMatchObject({
      id: "c1",
      kind: result.kind,
      label: result.label,
      reason: result.reason,
    });
    const detail = await getOwnedWishlist(repo, USER_A, listId);
    expect(detail.plans.map((s) => s.id)).toEqual([plan.id]);
    expect(detail.plans[0]).toMatchObject({ method: "preferences", spotCount: 3 });

    const got = await getPlan(repo, USER_A, plan.id);
    const items = plan.result.items;
    const spotIdx = items.flatMap((i, idx) => (i.type === "spot" ? [idx] : []));
    expect(got.segments.map((s) => [s.fromIndex, s.toIndex])).toEqual([
      [-1, spotIdx[0]],
      [spotIdx[0], spotIdx[1]],
      [spotIdx[1], spotIdx[2]],
      [spotIdx[2], items.length],
    ]);
    expect(got.segments[0].fromLabel).toBe("金沢駅");
    expect(got.segments[3].toLabel).toBe("金沢駅");
    const first = (await repo.spots.getById((items[spotIdx[0]] as SpotItem).spotId))!;
    expect(got.segments[0].toLabel).toBe(first.name);
    expect(got.segments[0].navUrl).toBe(
      `https://www.google.com/maps/dir/?api=1&origin=36.578,136.648&destination=${first.lat},${first.lng}&travelmode=transit`,
    );

    await expectApiError(getPlan(repo, USER_B, plan.id), 403);
    await expectApiError(deletePlan(repo, USER_B, plan.id), 403);
    await deletePlan(repo, USER_A, plan.id);
    await expectApiError(getPlan(repo, USER_A, plan.id), 404);
  });

  it("buildNavSegments：昼食は飛ばし、削除済みスポットも飛ばし、到着地が無ければ最後のスポットで終わる", () => {
    const item = (spotId: string): PlanItem => ({
      type: "spot",
      spotId,
      arrive: "10:00",
      stayMin: 30,
      depart: "10:30",
      travelMinToNext: null,
      next: null,
      inBestTime: false,
    });
    const lunch: PlanItem = {
      type: "lunch",
      arrive: "12:00",
      stayMin: 60,
      depart: "13:00",
      travelMinToNext: null,
      next: null,
    };
    const plan = {
      params: {
        ...params("b0000000-0000-4000-8000-0000000000aa", { mode: "walking" }),
        origin: { lat: 1, lng: 2, label: "" },
      },
      result: { items: [item("a"), lunch, item("gone"), item("b")] },
    } as unknown as Parameters<typeof buildNavSegments>[0];
    const segs = buildNavSegments(
      plan,
      new Map([
        ["a", { lat: 3, lng: 4, name: "A" }],
        ["b", { lat: 5, lng: 6, name: "B" }],
      ]),
    );
    expect(segs).toEqual([
      {
        fromIndex: -1,
        toIndex: 0,
        fromLabel: "出発地",
        toLabel: "A",
        navUrl: "https://www.google.com/maps/dir/?api=1&origin=1,2&destination=3,4&travelmode=walking",
      },
      {
        fromIndex: 0,
        toIndex: 3,
        fromLabel: "A",
        toLabel: "B",
        navUrl: "https://www.google.com/maps/dir/?api=1&origin=3,4&destination=5,6&travelmode=walking",
      },
    ]);
  });

  it("出発地・到着地の座標は小数 3 桁に丸めて保存し、線の両端も同じ精度にする（13章）", async () => {
    const listId = await listWith(USER_A, SPOTS);
    const origin = { lat: 36.57876543, lng: 136.64781234, label: "現在地" };
    const destination = { lat: 36.56234567, lng: 136.66212345, label: "現在地" };
    const p = params(listId, { origin, destination });
    const res = await computePlan(repo, USER_A, p, FALLBACK);
    const result = toResult(res.candidates[0], res.travelMatrixId);
    expect(result.geometry?.coordinates[0]).toEqual([origin.lng, origin.lat]);
    const plan = await savePlan(repo, USER_A, planSaveSchema.parse({ params: p, result }));
    expect(plan.params.origin).toEqual({ lat: 36.579, lng: 136.648, label: "現在地" });
    expect(plan.params.destination).toEqual({ lat: 36.562, lng: 136.662, label: "現在地" });
    expect(roundCoordinate(36.57876543)).toBe(36.579);
    const coords = plan.result.geometry!.coordinates;
    expect(coords[0]).toEqual([136.648, 36.579]);
    expect(coords.at(-1)).toEqual([136.662, 36.562]);
    expect(coords.slice(1, -1)).toEqual(result.geometry!.coordinates.slice(1, -1));
    expect(coarsenSavedPlan(plan.params, { ...plan.result, geometry: null }).result.geometry).toBeNull();
  });

  it("終了時刻を過ぎた案は保存できない（400）", async () => {
    const listId = await listWith(USER_A, SPOTS);
    const p = params(listId);
    const res = await computePlan(repo, USER_A, p, FALLBACK);
    const result = toResult(res.candidates[0], res.travelMatrixId);
    const late = { ...result, endAt: "23:30", stats: { ...result.stats, endAt: "23:30" } };
    await expectApiError(savePlan(repo, USER_A, planSaveSchema.parse({ params: p, result: late })), 400);
  });

  it("他人のリストへの保存は 403、存在しないリストは 404。不正な result はスキーマで 400", async () => {
    const listId = await listWith(USER_A, SPOTS);
    const p = params(listId);
    const res = await computePlan(repo, USER_A, p, FALLBACK);
    const result = toResult(res.candidates[0], res.travelMatrixId);
    await expectApiError(savePlan(repo, USER_B, planSaveSchema.parse({ params: p, result })), 403);
    const missing = params("b0000000-0000-4000-8000-ffffffffffff");
    await expectApiError(savePlan(repo, USER_A, planSaveSchema.parse({ params: missing, result })), 404);
    expect(planSaveSchema.safeParse({ params: p, result: { ...result, kind: "hacked" } }).success).toBe(
      false,
    );
    expect(
      planSaveSchema.safeParse({
        params: p,
        result: { ...result, skipped: [{ spotId: SPOTS[0], reason: "x" }] },
      }).success,
    ).toBe(false);
    const huge = {
      ...result,
      geometry: { type: "LineString", coordinates: Array.from({ length: 5001 }, () => [136.65, 36.56]) },
    };
    expect(planSaveSchema.safeParse({ params: p, result: huge }).success).toBe(false);
  });

  it("items / skipped の spotId が params.spotIds に無い、または同じスポットが 2 回あれば 400", async () => {
    const listId = await listWith(USER_A, SPOTS);
    const p = params(listId);
    const res = await computePlan(repo, USER_A, p, FALLBACK);
    const result = toResult(res.candidates[0], res.travelMatrixId);
    const foreign = "b0000000-0000-4000-8000-ffffffffffff";
    const items = result.items.map((i, idx) =>
      idx === 0 && i.type === "spot" ? { ...i, spotId: foreign } : i,
    );
    const err = await expectApiError(
      savePlan(repo, USER_A, planSaveSchema.parse({ params: p, result: { ...result, items } })),
      400,
      ITEM_NOT_IN_SPOTS_MESSAGE,
    );
    expect(err.details).toEqual([{ field: "result.items", reason: "not_in_spots", spotId: foreign }]);
    const duplicated = [...result.items, result.items[0]];
    await expectApiError(
      savePlan(repo, USER_A, planSaveSchema.parse({ params: p, result: { ...result, items: duplicated } })),
      400,
    );
  });

  it("date は実在する日付だけ受け付ける", () => {
    const base = params("b0000000-0000-4000-8000-0000000000aa");
    for (const date of ["2026-13-45", "2026-02-30", "2025-02-29", "2026-1-1"]) {
      expect(planComputeSchema.safeParse({ ...base, date }).success).toBe(false);
    }
    expect(planComputeSchema.safeParse({ ...base, date: "2024-02-29" }).success).toBe(true);
  });
});
