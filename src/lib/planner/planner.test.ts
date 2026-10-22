import { describe, expect, it } from "vitest";
import { CANDIDATE_LABELS, CATEGORY_DEFAULT_STAY_MIN, type TravelMode } from "@/lib/domain/constants";
import type { PlanItem, PlanPreferences } from "@/lib/domain/types";
import { coordKey, spotKey } from "@/lib/utils/geo";
import { hhmmToMinutes } from "@/lib/utils/time";
import {
  applicableHints,
  bestHoursOf,
  bestTimeDeviation,
  buildSchedule,
  candidateKindsFor,
  computeStayMinutes,
  isInBestTime,
  isLunchSkipped,
  NOTE_STRAIGHT_LINE,
  NOTE_TRANSIT_ESTIMATE,
  NOTE_WALK_FALLBACK,
  permutations,
  planRoute,
  prepareSpots,
  satisfiesHints,
  scoreBreakdown,
  simulate,
  type PlannerInput,
  type PlannerSpot,
  type ScheduleOptions,
  type TravelLeg,
  type TravelMatrix,
} from "./index";

const ORIGIN = { lat: 35.0, lng: 135.0 };
const ORIGIN_KEY = coordKey(ORIGIN);
const DEST = { lat: 35.1, lng: 135.1 };
const DEST_KEY = coordKey(DEST);

function spot(id: string, overrides: Partial<PlannerSpot> = {}): PlannerSpot {
  return {
    id,
    name: `スポット${id}`,
    lat: 35,
    lng: 135,
    category: "history",
    postCount: 0,
    stayMinutesMedian: null,
    hourHistogram: new Array(24).fill(0),
    openingHours: null,
    mustVisit: false,
    ...overrides,
  };
}

/** 投稿 10 件で、hours の時間帯だけに投稿があるスポット（おすすめ時間帯 = hours） */
function bestAt(id: string, hours: number[], overrides: Partial<PlannerSpot> = {}): PlannerSpot {
  const hist = new Array(24).fill(0);
  for (const h of hours) hist[h] = 10;
  return spot(id, { postCount: 10, hourHistogram: hist, ...overrides });
}

function prefs(overrides: Partial<PlanPreferences> = {}): PlanPreferences {
  return {
    pace: "normal",
    interests: [],
    priority: "fewer_moves",
    timeWindows: [],
    orderHints: [],
    exclude: [],
    ...overrides,
  };
}

/**
 * 数直線上の位置（km）から全ペアの行列を作る。1km = 10分。
 * positions のキーは行列のキー（coordKey / spotKey）。extra で区間の追加情報（mode / estimated / walkM）を足す。
 */
function lineMatrix(positions: Record<string, number>, extra: Partial<TravelLeg> = {}): TravelMatrix {
  const m: TravelMatrix = new Map();
  const keys = Object.keys(positions);
  for (const a of keys) {
    for (const b of keys) {
      if (a === b) continue;
      const km = Math.abs(positions[a] - positions[b]);
      m.set(`${a}|${b}`, { durationSec: km * 600, distanceM: km * 1000, ...extra });
    }
  }
  return m;
}

/** 平面座標（km）から全ペアの行列を作る。1km = 10分 */
function planeMatrix(points: Record<string, [number, number]>, extra: Partial<TravelLeg> = {}): TravelMatrix {
  const m: TravelMatrix = new Map();
  const keys = Object.keys(points);
  for (const a of keys) {
    for (const b of keys) {
      if (a === b) continue;
      const km = Math.hypot(points[a][0] - points[b][0], points[a][1] - points[b][1]);
      m.set(`${a}|${b}`, { durationSec: Math.round(km * 600), distanceM: Math.round(km * 1000), ...extra });
    }
  }
  return m;
}

function baseInput(
  spots: PlannerSpot[],
  matrix: TravelMatrix,
  overrides: Partial<PlannerInput> = {},
): PlannerInput {
  return {
    spots,
    originKey: ORIGIN_KEY,
    destinationKey: null,
    origin: ORIGIN,
    destination: null,
    date: "2026-11-03",
    startMin: hhmmToMinutes("09:00"),
    endMin: hhmmToMinutes("18:00"),
    mode: "driving",
    preferences: prefs(),
    lunchBreak: false,
    matrix,
    ...overrides,
  };
}

function scheduleOpts(matrix: TravelMatrix, overrides: Partial<ScheduleOptions> = {}): ScheduleOptions {
  return {
    startMin: hhmmToMinutes("09:00"),
    endMin: hhmmToMinutes("18:00"),
    originKey: ORIGIN_KEY,
    destinationKey: null,
    lunchBreak: false,
    date: "2026-11-03",
    mode: "driving",
    matrix,
    ...overrides,
  };
}

const spotIds = (items: PlanItem[]) => items.flatMap((i) => (i.type === "spot" ? [i.spotId] : []));

const LINE_ABC = { [ORIGIN_KEY]: 0, [spotKey("a")]: 1, [spotKey("b")]: 2, [spotKey("c")]: 3 };

describe("computeStayMinutes（11.2 の 1）", () => {
  it("投稿3件未満はカテゴリの標準値", () => {
    expect(
      computeStayMinutes(
        spot("a", { category: "nature", postCount: 2, stayMinutesMedian: 120 }),
        [],
        "normal",
      ),
    ).toBe(60);
    expect(computeStayMinutes(spot("a", { category: "photogenic" }), [], "normal")).toBe(
      CATEGORY_DEFAULT_STAY_MIN.photogenic,
    );
  });
  it("投稿3件以上で中央値があればそれを使う", () => {
    expect(computeStayMinutes(spot("a", { postCount: 3, stayMinutesMedian: 120 }), [], "normal")).toBe(120);
  });
  it("重視するもの ×1.2、ペース倍率を掛けて 5 分単位に丸める", () => {
    // 45 × 1.2 × 1.3 = 70.2 → 70
    expect(computeStayMinutes(spot("a", { category: "history" }), ["history"], "relaxed")).toBe(70);
    // 45 × 0.8 = 36 → 35
    expect(computeStayMinutes(spot("a", { category: "history" }), [], "packed")).toBe(35);
    // 60 × 1.2 × 0.8 = 57.6 → 60
    expect(computeStayMinutes(spot("a", { category: "gourmet" }), ["gourmet"], "packed")).toBe(60);
    expect(computeStayMinutes(spot("a", { category: "nature" }), ["gourmet"], "normal")).toBe(60);
  });
});

describe("おすすめ時間帯（11.2 の 2）", () => {
  it("投稿5件未満は null", () => {
    const hist = new Array(24).fill(0);
    hist[10] = 4;
    expect(bestHoursOf(spot("a", { postCount: 4, hourHistogram: hist }))).toBeNull();
  });
  it("最大値の 60% 以上の時間帯の集合", () => {
    const hist = new Array(24).fill(0);
    hist[9] = 5;
    hist[10] = 10;
    hist[11] = 6;
    hist[15] = 7;
    hist[20] = 1;
    const set = bestHoursOf(spot("a", { postCount: 29, hourHistogram: hist }));
    expect([...set!].sort((a, b) => a - b)).toEqual([10, 11, 15]);
  });
  it("isInBestTime は到着時刻の時で判定し、ずれは最も近い時間帯までの分", () => {
    const set = new Set([10, 11]);
    expect(isInBestTime(hhmmToMinutes("10:59"), set)).toBe(true);
    expect(isInBestTime(hhmmToMinutes("12:00"), set)).toBe(false);
    expect(isInBestTime(hhmmToMinutes("10:00"), null)).toBe(false);
    expect(bestTimeDeviation(hhmmToMinutes("09:30"), set)).toBe(30);
    expect(bestTimeDeviation(hhmmToMinutes("10:30"), set)).toBe(0);
    expect(bestTimeDeviation(hhmmToMinutes("12:30"), set)).toBe(31);
    expect(bestTimeDeviation(hhmmToMinutes("12:30"), null)).toBe(0);
  });
});

describe("buildSchedule（11.2 の 5）", () => {
  it("出発地から順に到着・滞在・出発を計算し、next と travelMinToNext に同じ移動時間を入れる", () => {
    const matrix = lineMatrix({ ...LINE_ABC, [DEST_KEY]: 4 });
    const r = buildSchedule([spot("a"), spot("b")], scheduleOpts(matrix, { destinationKey: DEST_KEY }));
    expect(r.feasible).toBe(true);
    expect(r.items).toEqual([
      {
        type: "spot",
        spotId: "a",
        arrive: "09:10",
        stayMin: 45,
        depart: "09:55",
        travelMinToNext: 10,
        next: { mode: "driving", travelMin: 10, estimated: false, walkM: null },
        inBestTime: false,
      },
      {
        type: "spot",
        spotId: "b",
        arrive: "10:05",
        stayMin: 45,
        depart: "10:50",
        travelMinToNext: 20,
        next: { mode: "driving", travelMin: 20, estimated: false, walkM: null },
        inBestTime: false,
      },
    ]);
    expect(r.endMin).toBe(hhmmToMinutes("11:10"));
    expect(r.totalTravelMin).toBe(40);
  });

  it("到着地が無ければ最後の項目の next は null", () => {
    const r = buildSchedule([spot("a")], scheduleOpts(lineMatrix(LINE_ABC)));
    expect(r.items[0]).toMatchObject({ next: null, travelMinToNext: null });
  });

  it("昼食は 11:30〜13:30 の間で最初に空いた時点（出発直後）に 60 分入る", () => {
    const a = spot("a", { postCount: 3, stayMinutesMedian: 120 }); // 09:10〜11:10
    const b = spot("b", { postCount: 3, stayMinutesMedian: 60 }); // 11:20〜12:20 → 昼食 12:20〜13:20
    const r = buildSchedule([a, b, spot("c")], scheduleOpts(lineMatrix(LINE_ABC), { lunchBreak: true }));
    expect(r.items.map((i) => i.type)).toEqual(["spot", "spot", "lunch", "spot"]);
    expect(r.items[1]).toMatchObject({ travelMinToNext: 0, next: { travelMin: 0 } });
    expect(r.items[2]).toMatchObject({
      type: "lunch",
      arrive: "12:20",
      depart: "13:20",
      stayMin: 60,
      travelMinToNext: 10,
      next: { travelMin: 10 },
    });
    expect(r.items[3]).toMatchObject({ spotId: "c", arrive: "13:30" });
  });

  it("窓の開始時に移動中なら到着後すぐに昼食を入れる", () => {
    const a = spot("a", { postCount: 3, stayMinutesMedian: 120 }); // 09:10〜11:10
    const matrix = lineMatrix({ [ORIGIN_KEY]: 0, [spotKey("a")]: 1, [spotKey("b")]: 5 });
    const r = buildSchedule([a, spot("b")], scheduleOpts(matrix, { lunchBreak: true }));
    expect(r.items.map((i) => i.type)).toEqual(["spot", "lunch", "spot"]);
    expect(r.items[0]).toMatchObject({ travelMinToNext: 40 });
    expect(r.items[1]).toMatchObject({ type: "lunch", arrive: "11:50", depart: "12:50", travelMinToNext: 0 });
    expect(r.items[2]).toMatchObject({ spotId: "b", arrive: "12:50" });
  });

  it("13:30 を過ぎてからは昼食を入れず、窓を跨ぐ滞在のときは lunchSkipped=true", () => {
    const a = spot("a", { postCount: 3, stayMinutesMedian: 270 });
    const r = buildSchedule([a, spot("b")], scheduleOpts(lineMatrix(LINE_ABC), { lunchBreak: true }));
    expect(r.items.map((i) => i.type)).toEqual(["spot", "spot"]);
    expect(r.lunchSkipped).toBe(true);
    expect(r.feasible).toBe(true);
  });

  it("isLunchSkipped：昼食なし・窓の前に終わる日・窓の後に始まる日は false", () => {
    const spotItem = (arrive: string, depart: string): PlanItem => ({
      type: "spot",
      spotId: "a",
      arrive,
      stayMin: 45,
      depart,
      travelMinToNext: null,
      next: null,
      inBestTime: false,
    });
    const lunchItem: PlanItem = {
      type: "lunch",
      arrive: "12:00",
      stayMin: 60,
      depart: "13:00",
      travelMinToNext: null,
      next: null,
    };
    expect(isLunchSkipped(false, hhmmToMinutes("09:00"), [spotItem("09:10", "14:00")])).toBe(false);
    expect(isLunchSkipped(true, hhmmToMinutes("09:00"), [spotItem("09:10", "11:00")])).toBe(false);
    expect(isLunchSkipped(true, hhmmToMinutes("14:00"), [spotItem("14:10", "15:00")])).toBe(false);
    expect(isLunchSkipped(true, hhmmToMinutes("09:00"), [spotItem("09:10", "11:00"), lunchItem])).toBe(false);
    expect(isLunchSkipped(true, hhmmToMinutes("09:00"), [spotItem("09:10", "14:00")])).toBe(true);
  });

  it("営業時間外の到着・終了時刻超過は feasible=false", () => {
    // 2026-11-03 は火曜（曜日 2）
    const a = spot("a", { openingHours: { "2": { open: "10:00", close: "17:00" } } });
    const matrix = lineMatrix(LINE_ABC);
    const early = buildSchedule([a], scheduleOpts(matrix));
    expect(early.infeasibleReason).toBe("opening_hours");
    expect(buildSchedule([a], scheduleOpts(matrix, { startMin: hhmmToMinutes("10:00") })).feasible).toBe(
      true,
    );
    const late = buildSchedule([spot("a")], scheduleOpts(matrix, { endMin: hhmmToMinutes("09:30") }));
    expect(late.infeasibleReason).toBe("time_limit");
  });

  it("時刻の指定（timeWindows）の外に着く順は feasible=false。指定があればおすすめ時間帯より優先", () => {
    const a = bestAt("a", [15]);
    const matrix = lineMatrix(LINE_ABC);
    const windows = [{ spotId: "a", from: "09:00", to: "09:30" }];
    const ok = buildSchedule(
      [a],
      scheduleOpts(matrix, { preferences: { ...prefs(), timeWindows: windows } }),
    );
    expect(ok.feasible).toBe(true);
    expect(ok.items[0]).toMatchObject({ inBestTime: true });
    expect(ok.offBestMinutes).toBe(0);
    const ng = buildSchedule(
      [a],
      scheduleOpts(matrix, {
        preferences: { ...prefs(), timeWindows: [{ spotId: "a", from: "10:00", to: "11:00" }] },
      }),
    );
    expect(ng.feasible).toBe(false);
    expect(ng.infeasibleReason).toBe("time_limit");
  });

  it("歩く距離：徒歩の区間は距離、公共交通で徒歩にした区間も数え walkFallback=true", () => {
    const walking = buildSchedule(
      [spot("a"), spot("b")],
      scheduleOpts(lineMatrix(LINE_ABC), { mode: "walking" }),
    );
    expect(walking.walkM).toBe(2000);
    expect(walking.items[0]).toMatchObject({ next: { mode: "walking", walkM: 1000 } });

    const matrix = lineMatrix(LINE_ABC, { mode: "transit", walkM: null, estimated: false });
    matrix.set(`${spotKey("a")}|${spotKey("b")}`, {
      durationSec: 600,
      distanceM: 1000,
      mode: "walking",
      estimated: true,
    });
    const transit = buildSchedule([spot("a"), spot("b")], scheduleOpts(matrix, { mode: "transit" }));
    expect(transit.walkFallback).toBe(true);
    expect(transit.walkM).toBe(1000);
    expect(transit.estimated).toBe(true);
    expect(transit.items[0]).toMatchObject({ next: { mode: "walking", estimated: true, walkM: 1000 } });
  });
});

describe("訪問順の全探索と順番の希望（11.2 の 4）", () => {
  it("全順列", () => {
    expect(permutations([1, 2, 3])).toHaveLength(6);
    expect(permutations([1, 2, 3, 4, 5, 6, 7, 8])).toHaveLength(40320);
    expect(new Set(permutations(["a", "b", "c", "d"]).map((p) => p.join())).size).toBe(24);
  });

  it("first / last / before / after を判定し、対象外のスポットへの希望は無視する", () => {
    const hints = [
      { spotId: "a", position: "first" as const },
      { spotId: "c", position: "last" as const },
      { spotId: "b", position: "before" as const, relativeTo: "d" },
    ];
    expect(satisfiesHints(["a", "b", "d", "c"], hints)).toBe(true);
    expect(satisfiesHints(["b", "a", "d", "c"], hints)).toBe(false);
    expect(satisfiesHints(["a", "d", "b", "c"], hints)).toBe(false);
    expect(satisfiesHints(["a", "b", "c", "d"], hints)).toBe(false);
    expect(satisfiesHints(["b", "a"], [{ spotId: "b", position: "after", relativeTo: "a" }])).toBe(false);
    const applicable = applicableHints(
      [...hints, { spotId: "x", position: "first" }, { spotId: "a", position: "after", relativeTo: "x" }],
      new Set(["a", "b", "c"]),
    );
    expect(applicable).toEqual([hints[0], hints[1]]);
  });
});

describe("点数（11.3）", () => {
  it("合計移動時間×a ＋ ずれ×b ＋ 歩く距離(km)×c − 回れる数×d。重みは優先することで変わる", () => {
    const s = { totalTravelMin: 48, offBestMinutes: 10, walkM: 2000, spotCount: 3 };
    expect(scoreBreakdown(s, "fewer_moves")).toEqual({
      travel: 48,
      offBest: 3,
      walk: 10,
      spots: 90,
      total: -29,
    });
    expect(scoreBreakdown(s, "more_spots").total).toBeCloseTo(48 * 0.5 + 3 + 6 - 270);
    expect(scoreBreakdown(s, "best_time").total).toBeCloseTo(48 * 0.7 + 10 + 6 - 90);
    expect(scoreBreakdown(s, "less_walking").total).toBeCloseTo(48 * 0.7 + 3 + 40 - 90);
  });
});

describe("planRoute（11.2・11.4）", () => {
  it("3 か所で移動が最小の順を c1 にし、同じ訪問順の案はまとめる", () => {
    const out = planRoute(baseInput([spot("c"), spot("a"), spot("b")], lineMatrix(LINE_ABC)));
    expect(out.candidates).toHaveLength(1);
    const c = out.candidates[0];
    expect(c).toMatchObject({ id: "c1", kind: "fewest_moves", label: CANDIDATE_LABELS.fewest_moves });
    expect(spotIds(c.items)).toEqual(["a", "b", "c"]);
    expect(c.reason).toBe("近い場所どうしをまとめ、移動を合計30分に抑えました");
    expect(c.stats).toEqual({ spotCount: 3, totalTravelMin: 30, walkM: 0, endAt: "11:45", bestTimeHits: 0 });
    expect(c.skipped).toEqual([]);
    expect(c.notes).toEqual([]);
    // 出発地 → 訪問順を結んだ線
    expect(c.geometry).toEqual({
      type: "LineString",
      coordinates: [
        [135, 35],
        [135, 35],
        [135, 35],
        [135, 35],
      ],
    });
  });

  it("おすすめ時間帯に合う案を別に出し、優先することに合う案を先頭にする", () => {
    // c は 9 時台がおすすめ。c を最初にすると 09:30 に着く（移動は増える）
    const spots = [spot("a"), spot("b"), bestAt("c", [9])];
    const out = planRoute(baseInput(spots, lineMatrix(LINE_ABC)));
    // 移動最小 a,b,c（30 分）/ 点数最小 a,c,b（40 分、c のずれ 16 分）/ c に 9 時台に着く c,b,a
    expect(out.candidates.map((c) => c.kind)).toEqual(["fewest_moves", "most_spots", "best_time"]);
    expect(out.candidates.map((c) => spotIds(c.items))).toEqual([
      ["a", "b", "c"],
      ["a", "c", "b"],
      ["c", "b", "a"],
    ]);
    expect(out.candidates[1].reason).toBe("3か所すべてを回れます");
    expect(out.candidates[2]).toMatchObject({ id: "c3", reason: "おすすめの時間帯に1か所で着きます" });
    expect(out.candidates[2].stats.bestTimeHits).toBe(1);

    const bt = planRoute(
      baseInput(spots, lineMatrix(LINE_ABC), { preferences: prefs({ priority: "best_time" }) }),
    );
    expect(bt.candidates.map((c) => c.kind)).toEqual(["best_time", "fewest_moves"]);
    expect(bt.candidates.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("歩く距離を少なくでは fewest_moves の代わりに least_walking を先頭に出す", () => {
    expect(candidateKindsFor("less_walking")).toEqual(["least_walking", "most_spots", "best_time"]);
    expect(candidateKindsFor("more_spots")).toEqual(["most_spots", "fewest_moves", "best_time"]);
    const out = planRoute(
      baseInput([spot("a"), spot("b")], lineMatrix(LINE_ABC), {
        mode: "walking",
        preferences: prefs({ priority: "less_walking" }),
      }),
    );
    expect(out.candidates[0]).toMatchObject({ kind: "least_walking", reason: "歩く距離を2.0kmに抑えました" });
    expect(out.candidates.some((c) => c.kind === "fewest_moves")).toBe(false);
  });

  it("各案はその種類の基準で全順列の中の最良（最大 3 案、訪問順は重複しない）", () => {
    const points: Record<string, [number, number]> = {
      [ORIGIN_KEY]: [0, 0],
      [spotKey("s1")]: [1, 3],
      [spotKey("s2")]: [4, 1],
      [spotKey("s3")]: [2, 5],
      [spotKey("s4")]: [5, 4],
      [spotKey("s5")]: [7, 2],
    };
    const spots = [spot("s1"), bestAt("s2", [14]), spot("s3"), bestAt("s4", [9]), spot("s5")];
    const input = baseInput(spots, planeMatrix(points), { mode: "walking" });
    const out = planRoute(input);
    expect(out.candidates.length).toBeGreaterThanOrEqual(2);
    expect(out.candidates.length).toBeLessThanOrEqual(3);
    const orders = out.candidates.map((c) => spotIds(c.items).join(","));
    expect(new Set(orders).size).toBe(orders.length);

    const opts = scheduleOpts(input.matrix, { mode: "walking", preferences: input.preferences });
    const prepared = prepareSpots(spots, opts);
    const sims = permutations(prepared).map((o) => simulate(o, opts));
    const minTravel = Math.min(...sims.map((s) => s.totalTravelMin));
    const maxHits = Math.max(...sims.map((s) => s.bestTimeHits));
    for (const c of out.candidates) {
      if (c.kind === "fewest_moves") expect(c.stats.totalTravelMin).toBe(minTravel);
      if (c.kind === "best_time") expect(c.stats.bestTimeHits).toBe(maxHits);
    }
    expect(out.candidates[0].kind).toBe("fewest_moves");
  });

  it("同点は訪問順の辞書順で決め、同じ入力なら同じ出力", () => {
    // a と b は同じ位置（どちらを先にしても同じ点数）
    const matrix = lineMatrix({ [ORIGIN_KEY]: 0, [spotKey("a")]: 1, [spotKey("b")]: 1 });
    const out1 = planRoute(baseInput([spot("b"), spot("a")], matrix));
    const out2 = planRoute(baseInput([spot("a"), spot("b")], matrix));
    expect(spotIds(out1.candidates[0].items)).toEqual(["a", "b"]);
    expect(out1).toEqual(out2);
  });

  it("到着地があれば往復を含めて最小にし、endAt は到着地に着く時刻。線は到着地まで", () => {
    const matrix = lineMatrix({ [ORIGIN_KEY]: 0, [spotKey("a")]: 1, [spotKey("b")]: 2, [DEST_KEY]: 0 });
    const out = planRoute(
      baseInput([spot("a"), spot("b")], matrix, { destinationKey: DEST_KEY, destination: DEST }),
    );
    const c = out.candidates[0];
    expect(c.stats.totalTravelMin).toBe(40);
    expect(c.stats.endAt).toBe("11:10");
    expect(c.items[1]).toMatchObject({ travelMinToNext: 20, next: { travelMin: 20 } });
    expect(c.geometry?.coordinates.at(-1)).toEqual([DEST.lng, DEST.lat]);
  });

  it("終了時刻を超えると必ず行きたい以外から外し（time_limit）、必ず行きたいは残る", () => {
    const spots = [spot("a", { mustVisit: true }), spot("b"), spot("c", { mustVisit: true })];
    // a(09:10〜09:55) → c(10:15〜11:00) で 11:00。b を入れると 11:45 になる
    const out = planRoute(baseInput(spots, lineMatrix(LINE_ABC), { endMin: hhmmToMinutes("11:30") }));
    expect(out.skipped).toEqual([{ spotId: "b", reason: "time_limit" }]);
    for (const c of out.candidates) {
      expect(spotIds(c.items).sort()).toEqual(["a", "c"]);
      expect(c.skipped).toEqual([{ spotId: "b", reason: "time_limit" }]);
      expect(hhmmToMinutes(c.stats.endAt)).toBeLessThanOrEqual(hhmmToMinutes("11:30"));
    }
  });

  it("外すときは外したあとの点数が最も良くなるものを選ぶ", () => {
    // c は遠い（10km）。終了時刻に入るには c を外すのが最良
    const matrix = lineMatrix({ [ORIGIN_KEY]: 0, [spotKey("a")]: 1, [spotKey("b")]: 2, [spotKey("c")]: 10 });
    const out = planRoute(
      baseInput([spot("a"), spot("b"), spot("c")], matrix, { endMin: hhmmToMinutes("11:00") }),
    );
    expect(out.skipped).toEqual([{ spotId: "c", reason: "time_limit" }]);
    expect(spotIds(out.candidates[0].items)).toEqual(["a", "b"]);
  });

  it("必ず行きたいだけでも入らなければ候補 0 件にし、全スポットを time_limit で skipped にする", () => {
    const spots = [spot("a", { mustVisit: true }), spot("b")];
    const out = planRoute(baseInput(spots, lineMatrix(LINE_ABC), { endMin: hhmmToMinutes("09:20") }));
    expect(out.candidates).toEqual([]);
    expect(out.skipped.map((s) => s.spotId).sort()).toEqual(["a", "b"]);
    expect(out.skipped.every((s) => s.reason === "time_limit")).toBe(true);
  });

  it("必ず行きたいが無く 1 か所も入らなければ候補 0 件（空の案は出さない）", () => {
    const out = planRoute(
      baseInput([spot("a"), spot("b")], lineMatrix(LINE_ABC), { endMin: hhmmToMinutes("09:05") }),
    );
    expect(out.candidates).toEqual([]);
    expect(out.skipped.map((s) => s.reason)).toEqual(["time_limit", "time_limit"]);
    const allExcluded = planRoute(
      baseInput([spot("a")], lineMatrix(LINE_ABC), { preferences: prefs({ exclude: ["a"] }) }),
    );
    expect(allExcluded).toEqual({ candidates: [], skipped: [{ spotId: "a", reason: "excluded" }] });
  });

  it("除外指定のスポットは excluded で外す", () => {
    const out = planRoute(
      baseInput([spot("a"), spot("b"), spot("c")], lineMatrix(LINE_ABC), {
        preferences: prefs({ exclude: ["b"] }),
      }),
    );
    expect(out.skipped).toEqual([{ spotId: "b", reason: "excluded" }]);
    expect(spotIds(out.candidates[0].items)).toEqual(["a", "c"]);
  });

  it("順番の希望を満たす順だけから選ぶ", () => {
    const last = planRoute(
      baseInput([spot("a"), spot("b"), spot("c")], lineMatrix(LINE_ABC), {
        preferences: prefs({ orderHints: [{ spotId: "a", position: "last" }] }),
      }),
    );
    for (const c of last.candidates) expect(spotIds(c.items).at(-1)).toBe("a");
    const before = planRoute(
      baseInput([spot("a"), spot("b"), spot("c")], lineMatrix(LINE_ABC), {
        preferences: prefs({ orderHints: [{ spotId: "c", position: "before", relativeTo: "a" }] }),
      }),
    );
    for (const c of before.candidates) {
      const ids = spotIds(c.items);
      expect(ids.indexOf("c")).toBeLessThan(ids.indexOf("a"));
    }
  });

  it("時刻の指定に着けない順は除外し、どの順でも着けないスポットは time_limit で外す", () => {
    const ok = planRoute(
      baseInput([spot("a"), spot("b"), spot("c")], lineMatrix(LINE_ABC), {
        preferences: prefs({ timeWindows: [{ spotId: "c", from: "09:00", to: "09:40" }] }),
      }),
    );
    for (const c of ok.candidates) expect(spotIds(c.items)[0]).toBe("c");
    const ng = planRoute(
      baseInput([spot("a"), spot("b"), spot("c")], lineMatrix(LINE_ABC), {
        preferences: prefs({ timeWindows: [{ spotId: "c", from: "07:00", to: "08:00" }] }),
      }),
    );
    expect(ng.skipped).toEqual([{ spotId: "c", reason: "time_limit" }]);
  });

  it("昼食休憩ありなら 11:30〜13:30 に lunch が入る", () => {
    const matrix = lineMatrix({ ...LINE_ABC, [spotKey("d")]: 4 });
    const out = planRoute(
      baseInput([spot("a"), spot("b"), spot("c"), spot("d")], matrix, { lunchBreak: true }),
    );
    const lunch = out.candidates[0].items.find((i) => i.type === "lunch")!;
    expect(hhmmToMinutes(lunch.arrive)).toBeGreaterThanOrEqual(hhmmToMinutes("11:30"));
    expect(hhmmToMinutes(lunch.arrive)).toBeLessThanOrEqual(hhmmToMinutes("13:30"));
  });

  it("定休日は opening_hours、行列に区間が無いスポットは no_route で外れる", () => {
    const closed = planRoute(
      baseInput([spot("a"), spot("b", { openingHours: { "2": null } })], lineMatrix(LINE_ABC)),
    );
    expect(closed.skipped).toEqual([{ spotId: "b", reason: "opening_hours" }]);
    const matrix = lineMatrix({ [ORIGIN_KEY]: 0, [spotKey("a")]: 1, [spotKey("b")]: 2 });
    const noRoute = planRoute(baseInput([spot("a"), spot("b"), spot("c")], matrix));
    expect(noRoute.skipped).toEqual([{ spotId: "c", reason: "no_route" }]);
    expect(spotIds(noRoute.candidates[0].items)).toEqual(["a", "b"]);
  });

  it("注意書き：公共交通は目安、概算の区間、徒歩で計算した区間", () => {
    const est = (mode: TravelMode) =>
      planRoute(baseInput([spot("a")], lineMatrix(LINE_ABC, { estimated: true }), { mode })).candidates[0]
        .notes;
    expect(est("transit")).toEqual([NOTE_TRANSIT_ESTIMATE, NOTE_STRAIGHT_LINE]);
    expect(est("driving")).toEqual([NOTE_STRAIGHT_LINE]);
    const matrix = lineMatrix(LINE_ABC, { mode: "walking" });
    const walk = planRoute(baseInput([spot("a")], matrix, { mode: "transit" })).candidates[0];
    expect(walk.notes).toEqual([NOTE_TRANSIT_ESTIMATE, NOTE_WALK_FALLBACK]);
    expect(walk.items[0]).toMatchObject({ next: null });
  });

  it("8 か所（8! 通り）で 1 秒以内に終わる", () => {
    const ids = Array.from({ length: 8 }, (_, i) => `s${i}`);
    const points: Record<string, [number, number]> = { [ORIGIN_KEY]: [0, 0], [DEST_KEY]: [6, 6] };
    ids.forEach((id, i) => {
      points[spotKey(id)] = [Math.cos(i) * 3 + 3, Math.sin(i * 1.7) * 3 + 3];
    });
    const spots = ids.map((id, i) => (i % 3 === 0 ? bestAt(id, [10 + i]) : spot(id)));
    const t0 = performance.now();
    const out = planRoute(
      baseInput(spots, planeMatrix(points), {
        destinationKey: DEST_KEY,
        destination: DEST,
        lunchBreak: true,
        preferences: prefs({ orderHints: [{ spotId: "s1", position: "before", relativeTo: "s2" }] }),
      }),
    );
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(out.candidates.length).toBeGreaterThan(0);
    for (const c of out.candidates)
      expect(hhmmToMinutes(c.stats.endAt)).toBeLessThanOrEqual(hhmmToMinutes("18:00"));
  });

  it("8 か所で終了時刻が厳しく除外が多段になっても 5 秒以内に終わる", () => {
    const ids = Array.from({ length: 8 }, (_, i) => `s${i}`);
    const points: Record<string, [number, number]> = { [ORIGIN_KEY]: [0, 0] };
    ids.forEach((id, i) => {
      points[spotKey(id)] = [Math.cos(i) * 3 + 3, Math.sin(i * 1.7) * 3 + 3];
    });
    const t0 = performance.now();
    const out = planRoute(
      baseInput(
        ids.map((id) => spot(id)),
        planeMatrix(points),
        { lunchBreak: true, endMin: hhmmToMinutes("11:00") },
      ),
    );
    expect(performance.now() - t0).toBeLessThan(5000);
    expect(out.candidates.length).toBeGreaterThan(0);
    expect(out.skipped.length).toBeGreaterThan(0);
    expect(out.skipped.every((s) => s.reason === "time_limit")).toBe(true);
    expect(hhmmToMinutes(out.candidates[0].stats.endAt)).toBeLessThanOrEqual(hhmmToMinutes("11:00"));
  });
});
