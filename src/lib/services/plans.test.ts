/**
 * 経路プラン API の service のテスト（memory モード、seed あり）。
 * 外部 API（OpenRouteService）は fetch をモックし、実際のネットワークには出ない。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { USAGE_LIMITS } from "@/lib/domain/constants";
import type { PlanItem, PlanResult } from "@/lib/domain/types";
import { estimateTravel } from "@/lib/external/fallback";
import { ORS_BASE_URL } from "@/lib/external/ors";
import { periodFor } from "@/lib/external/usage";
import { computeStayMinutes } from "@/lib/planner";
import { createMemoryRepository, SEED_USER_IDS } from "@/lib/repo/memory";
import { seedUuid } from "@/lib/repo/memory/seed";
import { haversineM } from "@/lib/utils/geo";
import { hhmmToMinutes, minutesToHHMM, nowIso } from "@/lib/utils/time";
import {
  planComputeSchema,
  planRecomputeSchema,
  planSaveSchema,
  type PlanComputeInput,
} from "@/lib/validation/schemas";
import { addWishlistItem, createWishlist, getOwnedWishlist, setWishlistItemMustVisit } from "./lists";
import { computePlan, deletePlan, getPlan, recomputePlan, savePlan, SPOT_NOT_IN_LIST_MESSAGE } from "./plans";

vi.mock("server-only", () => ({}));

const USER_A = SEED_USER_IDS.userA;
const USER_B = SEED_USER_IDS.userB;
/** 清水寺・伏見稲荷大社・金閣寺（seed の 1〜3 番目） */
const SPOTS = [seedUuid("spot", 1), seedUuid("spot", 2), seedUuid("spot", 3)];
const KYOTO_STATION = { lat: 34.9858, lng: 135.7588, label: "京都駅" };
const DATE = "2026-11-03";
/** 外部 API を使わない（直線距離の概算）。徒歩だと金閣寺が遠く 1 日に入らないので車で固定する */
const FALLBACK = { routingEnabled: false } as const;

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

/** userId のリストを作って spotIds を入れる */
async function listWith(userId: string, spotIds: string[]): Promise<string> {
  const list = await createWishlist(repo, userId, { name: "テスト" });
  for (const id of spotIds) await addWishlistItem(repo, userId, list.id, { spotId: id });
  return list.id;
}

function params(listId: string, overrides: Partial<PlanComputeInput> = {}): PlanComputeInput {
  return planComputeSchema.parse({
    listId,
    spotIds: SPOTS,
    origin: KYOTO_STATION,
    destination: null,
    date: DATE,
    startTime: "09:00",
    endTime: "18:00",
    mode: "driving",
    pace: "normal",
    interests: [],
    lunchBreak: false,
    ...overrides,
  });
}

function spotItems(items: PlanItem[]): Extract<PlanItem, { type: "spot" }>[] {
  return items.filter((i): i is Extract<PlanItem, { type: "spot" }> => i.type === "spot");
}

/** ORS の応答を真似る fetch。行列は直線距離から、経路形状は地点を結んだ線を返す */
function orsFetchMock() {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      locations?: [number, number][];
      coordinates?: [number, number][];
    };
    if (url.startsWith(`${ORS_BASE_URL}/v2/matrix/`)) {
      const pts = (body.locations ?? []).map(([lng, lat]) => ({ lat, lng }));
      const distances = pts.map((a) => pts.map((b) => Math.round(haversineM(a, b))));
      const durations = distances.map((row) => row.map((d) => Math.round(d / 1.25)));
      return new Response(JSON.stringify({ durations, distances }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.startsWith(`${ORS_BASE_URL}/v2/directions/`)) {
      const coordinates = body.coordinates ?? [];
      const fc = {
        type: "FeatureCollection",
        features: [{ type: "Feature", geometry: { type: "LineString", coordinates } }],
      };
      return new Response(JSON.stringify(fc), {
        status: 200,
        headers: { "content-type": "application/geo+json" },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

beforeEach(() => {
  repo = createMemoryRepository(true, { persist: false });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.ORS_API_KEY;
});

describe("computePlan（ORS 未設定：直線距離の概算）", () => {
  it("3 か所の順序と時刻が妥当（出発→到着の順、終了時刻以内、概算フラグ）", async () => {
    const listId = await listWith(USER_A, SPOTS);
    const result = await computePlan(repo, USER_A, params(listId), FALLBACK);

    const spots = spotItems(result.items);
    expect(spots).toHaveLength(3);
    expect(new Set(spots.map((s) => s.spotId))).toEqual(new Set(SPOTS));
    expect(result.skipped).toEqual([]);
    expect(result.estimated).toBe(true);
    expect(result.travelMatrixId).toMatch(/^tm_driving_[0-9a-f]{16}$/);

    // 時刻は単調に進み、滞在時間は arrive と depart の差に一致する
    let prev = hhmmToMinutes("09:00");
    for (const s of spots) {
      const arrive = hhmmToMinutes(s.arrive);
      const depart = hhmmToMinutes(s.depart);
      expect(arrive).toBeGreaterThan(prev);
      expect(depart - arrive).toBe(s.stayMin);
      expect(s.stayMin % 5).toBe(0);
      prev = depart;
    }
    expect(hhmmToMinutes(result.endAt)).toBeLessThanOrEqual(hhmmToMinutes("18:00"));
    expect(result.endAt).toBe(spots[2].depart);
    expect(spots[2].travelMinToNext).toBeNull();
    // 合計移動時間 = 出発地から最初のスポットまで ＋ 各スポット間
    const firstLegMin = hhmmToMinutes(spots[0].arrive) - hhmmToMinutes("09:00");
    expect(firstLegMin).toBeGreaterThan(0);
    expect(result.totalTravelMin).toBe(
      firstLegMin + spots.slice(0, 2).reduce((a, s) => a + (s.travelMinToNext ?? 0), 0),
    );

    // 最初の区間は出発地からの概算移動時間
    const first = await repo.spots.getById(spots[0].spotId);
    const leg = estimateTravel(KYOTO_STATION, first!, "driving");
    expect(hhmmToMinutes(spots[0].arrive)).toBe(hhmmToMinutes("09:00") + Math.ceil(leg.durationSec / 60));

    // 経路形状は出発地＋3 か所を結ぶ直線
    expect(result.geometry?.type).toBe("LineString");
    expect(result.geometry?.coordinates).toHaveLength(4);
    expect(result.geometry?.coordinates[0]).toEqual([KYOTO_STATION.lng, KYOTO_STATION.lat]);
  });

  it("到着地があれば最後に到着地への移動が入り、endAt は到着地に着く時刻", async () => {
    const listId = await listWith(USER_A, SPOTS);
    const result = await computePlan(repo, USER_A, params(listId, { destination: KYOTO_STATION }), FALLBACK);
    const spots = spotItems(result.items);
    expect(spots).toHaveLength(3);
    const last = spots[2];
    expect(last.travelMinToNext).toBeGreaterThan(0);
    expect(hhmmToMinutes(result.endAt)).toBe(hhmmToMinutes(last.depart) + (last.travelMinToNext ?? 0));
    expect(result.geometry?.coordinates).toHaveLength(5);
  });

  it("終了時刻を短くすると入らないスポットが time_limit になり、必ず行きたいは残る", async () => {
    const listId = await listWith(USER_A, SPOTS);
    const must = SPOTS[2];
    await setWishlistItemMustVisit(repo, USER_A, listId, must, { mustVisit: true });
    // 「必ず行きたい」1 か所だけがちょうど入る終了時刻にする
    const spot = (await repo.spots.getById(must))!;
    const travelMin = Math.ceil(estimateTravel(KYOTO_STATION, spot, "driving").durationSec / 60);
    const stayMin = computeStayMinutes(spot, [], "normal");
    const endTime = minutesToHHMM(hhmmToMinutes("09:00") + travelMin + stayMin + 5);

    const result = await computePlan(repo, USER_A, params(listId, { endTime }), FALLBACK);
    expect(spotItems(result.items).map((s) => s.spotId)).toEqual([must]);
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped.every((s) => s.reason === "time_limit")).toBe(true);
    expect(new Set(result.skipped.map((s) => s.spotId))).toEqual(new Set([SPOTS[0], SPOTS[1]]));
    expect(hhmmToMinutes(result.endAt)).toBeLessThanOrEqual(hhmmToMinutes(endTime));
  });

  it("「必ず行きたい」だけでも入らなければ items は空で全スポットが time_limit", async () => {
    const listId = await listWith(USER_A, SPOTS);
    await setWishlistItemMustVisit(repo, USER_A, listId, SPOTS[2], { mustVisit: true });
    const result = await computePlan(repo, USER_A, params(listId, { endTime: "09:10" }), FALLBACK);
    expect(result.items).toEqual([]);
    expect(result.skipped.map((s) => s.reason)).toEqual(["time_limit", "time_limit", "time_limit"]);
    expect(result.geometry).toBeNull();
    expect(result.endAt).toBe("09:00");
  });

  it("昼食休憩を入れると lunch の項目（60 分）が入る", async () => {
    const listId = await listWith(USER_A, SPOTS);
    const result = await computePlan(repo, USER_A, params(listId, { lunchBreak: true }), FALLBACK);
    const lunch = result.items.filter((i) => i.type === "lunch");
    expect(lunch).toHaveLength(1);
    expect(lunch[0]).toMatchObject({ type: "lunch", stayMin: 60 });
    expect(hhmmToMinutes(lunch[0].depart) - hhmmToMinutes(lunch[0].arrive)).toBe(60);
    expect(hhmmToMinutes(lunch[0].arrive)).toBeGreaterThanOrEqual(hhmmToMinutes("11:30"));
    expect(spotItems(result.items)).toHaveLength(3);
    // 昼食があっても経路形状はスポットだけを結ぶ
    expect(result.geometry?.coordinates).toHaveLength(4);
  });

  it("重視するものとペースが滞在時間に反映される", async () => {
    const listId = await listWith(USER_A, SPOTS);
    const normal = await computePlan(repo, USER_A, params(listId), FALLBACK);
    const relaxed = await computePlan(
      repo,
      USER_A,
      params(listId, { pace: "relaxed", interests: ["history"] }),
      FALLBACK,
    );
    const stayOf = (r: PlanResult, id: string) => spotItems(r.items).find((s) => s.spotId === id)!.stayMin;
    for (const id of SPOTS) {
      const spot = (await repo.spots.getById(id))!;
      expect(stayOf(normal, id)).toBe(computeStayMinutes(spot, [], "normal"));
      expect(stayOf(relaxed, id)).toBe(computeStayMinutes(spot, ["history"], "relaxed"));
      expect(stayOf(relaxed, id)).toBeGreaterThan(stayOf(normal, id));
    }
  });

  it("投稿が 0 件のスポットは deleted として外し、残りで計算する", async () => {
    const empty = await repo.spots.create({
      name: "投稿のないスポット",
      lat: 35.0,
      lng: 135.76,
      category: "other",
      source: "gps",
      createdBy: USER_A,
    });
    const listId = await listWith(USER_A, [SPOTS[0], empty.id]);
    const result = await computePlan(
      repo,
      USER_A,
      params(listId, { spotIds: [SPOTS[0], empty.id] }),
      FALLBACK,
    );
    expect(result.skipped).toEqual([{ spotId: empty.id, reason: "deleted" }]);
    expect(spotItems(result.items).map((s) => s.spotId)).toEqual([SPOTS[0]]);
  });

  it("対象がすべて削除済みなら外部 API を呼ばず空の結果", async () => {
    const empty = await repo.spots.create({
      name: "空",
      lat: 35.0,
      lng: 135.76,
      category: "other",
      source: "gps",
      createdBy: USER_A,
    });
    const listId = await listWith(USER_A, [empty.id]);
    const fetchMock = orsFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    process.env.ORS_API_KEY = "test-key";
    const result = await computePlan(repo, USER_A, params(listId, { spotIds: [empty.id] }));
    expect(result).toMatchObject({
      items: [],
      skipped: [{ spotId: empty.id, reason: "deleted" }],
      geometry: null,
      endAt: "09:00",
      estimated: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("computePlan（権限・入力・停止中）", () => {
  it("他人のリストは 403、存在しないリストは 404", async () => {
    const listId = await listWith(USER_A, SPOTS);
    await expectApiError(computePlan(repo, USER_B, params(listId), FALLBACK), 403);
    await expectApiError(
      computePlan(repo, USER_A, params("b0000000-0000-4000-8000-ffffffffffff"), FALLBACK),
      404,
    );
  });

  it("リストに無いスポットは 400（VALIDATION_ERROR）", async () => {
    const listId = await listWith(USER_A, [SPOTS[0], SPOTS[1]]);
    const err = await expectApiError(
      computePlan(repo, USER_A, params(listId), FALLBACK),
      400,
      SPOT_NOT_IN_LIST_MESSAGE,
    );
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.details).toEqual([{ field: "spotIds", reason: "not_in_list", spotId: SPOTS[2] }]);
  });

  it("経路作成が停止中（F-8）なら 503 FEATURE_SUSPENDED（details.feature）", async () => {
    const listId = await listWith(USER_A, SPOTS);
    const { provider, feature, limit } = USAGE_LIMITS.ors_matrix;
    const period = periodFor("ors_matrix");
    await repo.apiUsage.increment(provider, feature, period, limit, limit);
    await repo.apiUsage.setSuspended(provider, feature, period, nowIso());
    const err = await expectApiError(computePlan(repo, USER_A, params(listId), FALLBACK), 503);
    expect(err.code).toBe("FEATURE_SUSPENDED");
    expect(err.details).toEqual({ feature: "route_planning" });
  });
});

describe("computePlan（ORS あり：fetch をモック）", () => {
  it("外部 API は行列 1 回＋経路形状 1 回だけ。2 回目はキャッシュで行列を呼ばない", async () => {
    const fetchMock = orsFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    process.env.ORS_API_KEY = "test-key";
    const listId = await listWith(USER_A, SPOTS);

    const result = await computePlan(repo, USER_A, params(listId));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toBe(`${ORS_BASE_URL}/v2/matrix/driving-car`);
    expect(urls[1]).toBe(`${ORS_BASE_URL}/v2/directions/driving-car/geojson`);
    // API キーはヘッダーで渡され、URL には出ない
    expect(urls.every((u) => !u.includes("test-key"))).toBe(true);
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: "test-key" });

    expect(result.estimated).toBe(false);
    expect(spotItems(result.items)).toHaveLength(3);
    expect(result.geometry?.type).toBe("LineString");
    expect(result.geometry?.coordinates).toHaveLength(4);
    // 無料枠の回数は行列 1 回＋経路形状 1 回（ors / route_planning の同じ行に数える）
    expect(await repo.apiUsage.get("ors", "route_planning", periodFor("ors_matrix"))).toMatchObject({
      count: 2,
    });

    const again = await computePlan(repo, USER_A, params(listId));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2][0])).toContain("/v2/directions/");
    expect(await repo.apiUsage.get("ors", "route_planning", periodFor("ors_matrix"))).toMatchObject({
      count: 3,
    });
    expect(again.travelMatrixId).toBe(result.travelMatrixId);
    expect(again.items).toEqual(result.items);
  });

  it("経路形状の取得に失敗しても直線で代替し、結果は返る", async () => {
    const base = orsFetchMock();
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes("/v2/directions/")) return new Response("error", { status: 500 });
      return base(input, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.ORS_API_KEY = "test-key";
    const listId = await listWith(USER_A, SPOTS);
    const result = await computePlan(repo, USER_A, params(listId));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(spotItems(result.items)).toHaveLength(3);
    expect(result.geometry?.coordinates).toHaveLength(4);
    expect(result.estimated).toBe(true);
  });
});

describe("recomputePlan（F-5-6：外部 API を呼ばない）", () => {
  it("order の順に並べ、stayOverrides を反映し、fetch を呼ばない", async () => {
    const fetchMock = orsFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    process.env.ORS_API_KEY = "test-key";
    const listId = await listWith(USER_A, SPOTS);
    const order = [SPOTS[2], SPOTS[0], SPOTS[1]];
    const input = planRecomputeSchema.parse({
      params: params(listId, { destination: KYOTO_STATION }),
      travelMatrixId: "tm_driving_0123456789abcdef",
      order,
      stayOverrides: { [SPOTS[0]]: 15 },
    });

    const result = await recomputePlan(repo, USER_A, input);
    expect(fetchMock).not.toHaveBeenCalled();
    const spots = spotItems(result.items);
    expect(spots.map((s) => s.spotId)).toEqual(order);
    expect(spots[1].stayMin).toBe(15);
    expect(hhmmToMinutes(spots[1].depart) - hhmmToMinutes(spots[1].arrive)).toBe(15);
    expect(result.skipped).toEqual([]);
    expect(result.travelMatrixId).toBe("tm_driving_0123456789abcdef");
    // キャッシュが無いので概算、経路形状は直線（出発地 + 3 か所 + 到着地）
    expect(result.estimated).toBe(true);
    expect(result.geometry?.coordinates).toHaveLength(5);
    expect(result.geometry?.coordinates[4]).toEqual([KYOTO_STATION.lng, KYOTO_STATION.lat]);
    expect(hhmmToMinutes(result.endAt)).toBe(
      hhmmToMinutes(spots[2].depart) + (spots[2].travelMinToNext ?? 0),
    );
  });

  it("終了時刻を超えても items を返す（画面は endAt で判断する）", async () => {
    const listId = await listWith(USER_A, SPOTS);
    const input = planRecomputeSchema.parse({
      params: params(listId, { endTime: "10:00" }),
      travelMatrixId: "tm_x",
      order: SPOTS,
      stayOverrides: {},
    });
    const result = await recomputePlan(repo, USER_A, input);
    expect(spotItems(result.items)).toHaveLength(3);
    expect(hhmmToMinutes(result.endAt)).toBeGreaterThan(hhmmToMinutes("10:00"));
    expect(result.skipped).toEqual([]);
  });

  it("compute 後のキャッシュを使い、order に無いスポットは time_limit として残す", async () => {
    const fetchMock = orsFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    process.env.ORS_API_KEY = "test-key";
    const listId = await listWith(USER_A, SPOTS);
    const computed = await computePlan(repo, USER_A, params(listId));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const input = planRecomputeSchema.parse({
      params: params(listId),
      travelMatrixId: computed.travelMatrixId,
      order: [SPOTS[1], SPOTS[0]],
      stayOverrides: {},
    });
    const result = await recomputePlan(repo, USER_A, input);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.estimated).toBe(false);
    expect(spotItems(result.items).map((s) => s.spotId)).toEqual([SPOTS[1], SPOTS[0]]);
    expect(result.skipped).toEqual([{ spotId: SPOTS[2], reason: "time_limit" }]);
    expect(result.geometry?.coordinates).toHaveLength(3);
  });

  it("他人のリストは 403、spotIds に無いスポットが order にあれば 400", async () => {
    const listId = await listWith(USER_A, SPOTS);
    const base = {
      params: params(listId, { spotIds: [SPOTS[0], SPOTS[1]] }),
      travelMatrixId: "tm_x",
      stayOverrides: {},
    };
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

describe("savePlan / getPlan / deletePlan（F-5-7）", () => {
  it("保存したプランはリスト詳細に出て、本人だけが取得・削除できる", async () => {
    const listId = await listWith(USER_A, SPOTS);
    const p = params(listId);
    const result = await computePlan(repo, USER_A, p, FALLBACK);
    const plan = await savePlan(repo, USER_A, planSaveSchema.parse({ params: p, result }));
    expect(plan).toMatchObject({
      userId: USER_A,
      wishlistId: listId,
      date: DATE,
      spotCount: 3,
      totalTravelMin: result.totalTravelMin,
    });
    expect(plan.params).toEqual(p);
    expect(plan.result).toEqual(result);

    const detail = await getOwnedWishlist(repo, USER_A, listId);
    expect(detail.plans.map((s) => s.id)).toEqual([plan.id]);
    expect(detail.plans[0]).toMatchObject({ wishlistId: listId, spotCount: 3 });

    expect(await getPlan(repo, USER_A, plan.id)).toEqual(plan);
    await expectApiError(getPlan(repo, USER_B, plan.id), 403);
    await expectApiError(deletePlan(repo, USER_B, plan.id), 403);

    await deletePlan(repo, USER_A, plan.id);
    await expectApiError(getPlan(repo, USER_A, plan.id), 404);
    await expectApiError(deletePlan(repo, USER_A, plan.id), 404);
    expect((await getOwnedWishlist(repo, USER_A, listId)).plans).toEqual([]);
  });

  it("他人のリストへの保存は 403、存在しないリストは 404", async () => {
    const listId = await listWith(USER_A, SPOTS);
    const p = params(listId);
    const result = await computePlan(repo, USER_A, p, FALLBACK);
    await expectApiError(savePlan(repo, USER_B, planSaveSchema.parse({ params: p, result })), 403);
    const missing = params("b0000000-0000-4000-8000-ffffffffffff");
    await expectApiError(savePlan(repo, USER_A, planSaveSchema.parse({ params: missing, result })), 404);
  });
});
