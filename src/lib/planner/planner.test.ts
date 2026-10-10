import { describe, expect, it } from "vitest";
import { CATEGORY_DEFAULT_STAY_MIN } from "@/lib/domain/constants";
import { coordKey, spotKey } from "@/lib/utils/geo";
import { hhmmToMinutes } from "@/lib/utils/time";
import {
  bestHoursOf,
  buildSchedule,
  candidateOrders,
  computeStayMinutes,
  isInBestTime,
  pathCostSec,
  permutations,
  planRoute,
  type PlannerInput,
  type PlannerSpot,
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

/**
 * 数直線上の位置（km）から全ペアの行列を作る。1km = 10分。
 * positions のキーは行列のキー（coordKey / spotKey）。
 */
function lineMatrix(positions: Record<string, number>): TravelMatrix {
  const m: TravelMatrix = new Map();
  const keys = Object.keys(positions);
  for (const a of keys) {
    for (const b of keys) {
      if (a === b) continue;
      const km = Math.abs(positions[a] - positions[b]);
      m.set(`${a}|${b}`, { durationSec: km * 600, distanceM: km * 1000 });
    }
  }
  return m;
}

/** 平面座標（km）から全ペアの行列を作る。1km = 10分 */
function planeMatrix(points: Record<string, [number, number]>): TravelMatrix {
  const m: TravelMatrix = new Map();
  const keys = Object.keys(points);
  for (const a of keys) {
    for (const b of keys) {
      if (a === b) continue;
      const dx = points[a][0] - points[b][0];
      const dy = points[a][1] - points[b][1];
      const km = Math.hypot(dx, dy);
      m.set(`${a}|${b}`, { durationSec: Math.round(km * 600), distanceM: Math.round(km * 1000) });
    }
  }
  return m;
}

function baseInput(spots: PlannerSpot[], matrix: TravelMatrix, overrides: Partial<PlannerInput> = {}): PlannerInput {
  return {
    spots,
    originKey: ORIGIN_KEY,
    destinationKey: null,
    date: "2026-11-03",
    startMin: hhmmToMinutes("09:00"),
    endMin: hhmmToMinutes("18:00"),
    pace: "normal",
    interests: [],
    lunchBreak: false,
    matrix,
    ...overrides,
  };
}

describe("computeStayMinutes（11.1）", () => {
  it("投稿3件未満はカテゴリの標準値", () => {
    expect(computeStayMinutes(spot("a", { category: "nature", postCount: 2, stayMinutesMedian: 120 }), [], "normal")).toBe(60);
    expect(computeStayMinutes(spot("a", { category: "photogenic" }), [], "normal")).toBe(CATEGORY_DEFAULT_STAY_MIN.photogenic);
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
    // 重視に当てはまらなければ倍率なし
    expect(computeStayMinutes(spot("a", { category: "nature" }), ["gourmet"], "normal")).toBe(60);
  });
});

describe("bestHours（11.2）", () => {
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
    expect(set).not.toBeNull();
    expect([...set!].sort((a, b) => a - b)).toEqual([10, 11, 15]);
  });
  it("isInBestTime は到着時刻の時で判定する", () => {
    const set = new Set([10, 11]);
    expect(isInBestTime(hhmmToMinutes("10:59"), set)).toBe(true);
    expect(isInBestTime(hhmmToMinutes("12:00"), set)).toBe(false);
    expect(isInBestTime(hhmmToMinutes("10:00"), null)).toBe(false);
  });
});

describe("buildSchedule（11.5）", () => {
  it("出発地から順に到着・滞在・出発を計算し travelMinToNext を埋める", () => {
    const a = spot("a");
    const b = spot("b");
    const matrix = lineMatrix({ [ORIGIN_KEY]: 0, [spotKey("a")]: 1, [spotKey("b")]: 2, [DEST_KEY]: 3 });
    const r = buildSchedule([a, b], {
      startMin: hhmmToMinutes("09:00"),
      endMin: hhmmToMinutes("18:00"),
      originKey: ORIGIN_KEY,
      destinationKey: DEST_KEY,
      lunchBreak: false,
      date: "2026-11-03",
      matrix,
    });
    expect(r.feasible).toBe(true);
    expect(r.items).toEqual([
      { type: "spot", spotId: "a", arrive: "09:10", stayMin: 45, depart: "09:55", travelMinToNext: 10, inBestTime: false },
      { type: "spot", spotId: "b", arrive: "10:05", stayMin: 45, depart: "10:50", travelMinToNext: 10, inBestTime: false },
    ]);
    expect(r.endMin).toBe(hhmmToMinutes("11:00"));
    expect(r.totalTravelMin).toBe(30);
  });

  it("昼食は 11:30〜13:30 の間で最初に空いた時点（出発直後）に 60 分入る", () => {
    const a = spot("a", { postCount: 3, stayMinutesMedian: 120 }); // 09:10〜11:10
    const b = spot("b", { postCount: 3, stayMinutesMedian: 60 }); // 11:20〜12:20 → 昼食 12:20〜13:20
    const c = spot("c");
    const matrix = lineMatrix({ [ORIGIN_KEY]: 0, [spotKey("a")]: 1, [spotKey("b")]: 2, [spotKey("c")]: 3 });
    const r = buildSchedule([a, b, c], {
      startMin: hhmmToMinutes("09:00"),
      endMin: hhmmToMinutes("18:00"),
      originKey: ORIGIN_KEY,
      destinationKey: null,
      lunchBreak: true,
      date: "2026-11-03",
      matrix,
    });
    const lunch = r.items.find((i) => i.type === "lunch");
    expect(lunch).toEqual({ type: "lunch", arrive: "12:20", stayMin: 60, depart: "13:20", travelMinToNext: 10 });
    expect(r.items.map((i) => i.type)).toEqual(["spot", "spot", "lunch", "spot"]);
    const bItem = r.items[1];
    expect(bItem.travelMinToNext).toBe(0);
    const cItem = r.items[3];
    expect(cItem.arrive).toBe("13:30");
    expect(hhmmToMinutes(lunch!.arrive)).toBeGreaterThanOrEqual(hhmmToMinutes("11:30"));
    expect(hhmmToMinutes(lunch!.arrive)).toBeLessThanOrEqual(hhmmToMinutes("13:30"));
  });

  it("窓の開始時に移動中なら到着後すぐに昼食を入れる", () => {
    const a = spot("a", { postCount: 3, stayMinutesMedian: 120 }); // 09:10〜11:10
    const b = spot("b"); // 11:10 出発 → 移動 40 分 → 11:50 到着 → 昼食 11:50〜12:50
    const matrix = lineMatrix({ [ORIGIN_KEY]: 0, [spotKey("a")]: 1, [spotKey("b")]: 5 });
    const r = buildSchedule([a, b], {
      startMin: hhmmToMinutes("09:00"),
      endMin: hhmmToMinutes("18:00"),
      originKey: ORIGIN_KEY,
      destinationKey: null,
      lunchBreak: true,
      date: "2026-11-03",
      matrix,
    });
    expect(r.items.map((i) => i.type)).toEqual(["spot", "lunch", "spot"]);
    expect(r.items[1]).toMatchObject({ type: "lunch", arrive: "11:50", depart: "12:50", travelMinToNext: 0 });
    expect(r.items[2]).toMatchObject({ spotId: "b", arrive: "12:50" });
  });

  it("営業時間外の到着は feasible=false", () => {
    // 2026-11-03 は火曜（曜日 2）
    const a = spot("a", { openingHours: { "2": { open: "10:00", close: "17:00" } } });
    const matrix = lineMatrix({ [ORIGIN_KEY]: 0, [spotKey("a")]: 1 });
    const early = buildSchedule([a], {
      startMin: hhmmToMinutes("09:00"),
      endMin: hhmmToMinutes("18:00"),
      originKey: ORIGIN_KEY,
      destinationKey: null,
      lunchBreak: false,
      date: "2026-11-03",
      matrix,
    });
    expect(early.feasible).toBe(false);
    expect(early.infeasibleReason).toBe("opening_hours");
    const ok = buildSchedule([a], {
      startMin: hhmmToMinutes("10:00"),
      endMin: hhmmToMinutes("18:00"),
      originKey: ORIGIN_KEY,
      destinationKey: null,
      lunchBreak: false,
      date: "2026-11-03",
      matrix,
    });
    expect(ok.feasible).toBe(true);
  });

  it("終了時刻を超えると feasible=false", () => {
    const a = spot("a");
    const matrix = lineMatrix({ [ORIGIN_KEY]: 0, [spotKey("a")]: 1 });
    const r = buildSchedule([a], {
      startMin: hhmmToMinutes("09:00"),
      endMin: hhmmToMinutes("09:30"),
      originKey: ORIGIN_KEY,
      destinationKey: null,
      lunchBreak: false,
      date: "2026-11-03",
      matrix,
    });
    expect(r.feasible).toBe(false);
    expect(r.infeasibleReason).toBe("time_limit");
  });

  it("おすすめ時間帯から外れた到着は offBestMinutes に滞在分を加算する", () => {
    const hist = new Array(24).fill(0);
    hist[15] = 10;
    const a = spot("a", { postCount: 10, hourHistogram: hist });
    const matrix = lineMatrix({ [ORIGIN_KEY]: 0, [spotKey("a")]: 1 });
    const r = buildSchedule([a], {
      startMin: hhmmToMinutes("09:00"),
      endMin: hhmmToMinutes("18:00"),
      originKey: ORIGIN_KEY,
      destinationKey: null,
      lunchBreak: false,
      date: "2026-11-03",
      matrix,
    });
    expect(r.offBestMinutes).toBe(45);
    expect(r.items[0]).toMatchObject({ inBestTime: false });
  });
});

describe("candidateOrders（11.4）", () => {
  it("8 か所以下は全順列", () => {
    expect(permutations([1, 2, 3])).toHaveLength(6);
    const spots = [spot("a"), spot("b"), spot("c")];
    const orders = candidateOrders(spots, { matrix: new Map(), originKey: ORIGIN_KEY, destinationKey: null });
    expect(orders).toHaveLength(6);
  });

  it("9 か所は 2-opt で全探索と同等の解を出す（小さな行列）", () => {
    const points: Record<string, [number, number]> = {
      [ORIGIN_KEY]: [0, 0],
      [spotKey("s1")]: [1, 3],
      [spotKey("s2")]: [4, 1],
      [spotKey("s3")]: [2, 5],
      [spotKey("s4")]: [5, 4],
      [spotKey("s5")]: [7, 2],
      [spotKey("s6")]: [3, 7],
      [spotKey("s7")]: [6, 6],
      [spotKey("s8")]: [8, 5],
      [spotKey("s9")]: [1, 1],
    };
    const matrix = planeMatrix(points);
    const spots = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9"].map((id) => spot(id));
    const ctx = { matrix, originKey: ORIGIN_KEY, destinationKey: null };
    const orders = candidateOrders(spots, ctx);
    expect(orders.length).toBeGreaterThanOrEqual(1);
    const twoOptBest = Math.min(...orders.map((o) => pathCostSec(o, ctx)));
    let exhaustiveBest = Number.POSITIVE_INFINITY;
    for (const o of permutations(spots)) {
      const c = pathCostSec(o, ctx);
      if (c < exhaustiveBest) exhaustiveBest = c;
    }
    expect(twoOptBest).toBe(exhaustiveBest);
  });
});

describe("planRoute（11.4〜11.7）", () => {
  it("3 か所で移動時間が最小になる順を採用する", () => {
    const spots = [spot("c"), spot("a"), spot("b")];
    const matrix = lineMatrix({ [ORIGIN_KEY]: 0, [spotKey("a")]: 1, [spotKey("b")]: 2, [spotKey("c")]: 3 });
    const out = planRoute(baseInput(spots, matrix));
    expect(out.items.filter((i) => i.type === "spot").map((i) => (i.type === "spot" ? i.spotId : ""))).toEqual(["a", "b", "c"]);
    expect(out.totalTravelMin).toBe(30);
    expect(out.skipped).toEqual([]);
    expect(out.endAt).toBe("11:45");
  });

  it("到着地があれば往復を含めて最小にし、endAt は到着地への到着時刻", () => {
    const spots = [spot("a"), spot("b")];
    const matrix = lineMatrix({ [ORIGIN_KEY]: 0, [spotKey("a")]: 1, [spotKey("b")]: 2, [DEST_KEY]: 0 });
    const out = planRoute(baseInput(spots, matrix, { destinationKey: DEST_KEY }));
    expect(out.totalTravelMin).toBe(40);
    expect(out.endAt).toBe("11:10");
    expect(out.items[1].travelMinToNext).toBe(20);
  });

  it("終了時刻を超えると mustVisit 以外が外れ、mustVisit は残る", () => {
    const spots = [spot("a", { mustVisit: true }), spot("b"), spot("c", { mustVisit: true })];
    const matrix = lineMatrix({ [ORIGIN_KEY]: 0, [spotKey("a")]: 1, [spotKey("b")]: 2, [spotKey("c")]: 3 });
    // a(09:10〜09:55) → c(10:15〜11:00) で 11:00。b を入れると 11:45 になる
    const out = planRoute(baseInput(spots, matrix, { endMin: hhmmToMinutes("11:30") }));
    expect(out.skipped).toEqual([{ spotId: "b", reason: "time_limit" }]);
    const ids = out.items.map((i) => (i.type === "spot" ? i.spotId : "lunch"));
    expect(ids.sort()).toEqual(["a", "c"]);
    expect(hhmmToMinutes(out.endAt)).toBeLessThanOrEqual(hhmmToMinutes("11:30"));
  });

  it("mustVisit だけでも入らなければ items を空にして全スポットを skipped にする", () => {
    const spots = [spot("a", { mustVisit: true }), spot("b")];
    const matrix = lineMatrix({ [ORIGIN_KEY]: 0, [spotKey("a")]: 1, [spotKey("b")]: 2 });
    const out = planRoute(baseInput(spots, matrix, { endMin: hhmmToMinutes("09:20") }));
    expect(out.items).toEqual([]);
    expect(out.skipped.map((s) => s.spotId).sort()).toEqual(["a", "b"]);
    expect(out.skipped.every((s) => s.reason === "time_limit")).toBe(true);
    expect(out.endAt).toBe("09:00");
  });

  it("昼食休憩ありなら 11:30〜13:30 に lunch が入る", () => {
    const spots = [spot("a"), spot("b"), spot("c"), spot("d")];
    const matrix = lineMatrix({ [ORIGIN_KEY]: 0, [spotKey("a")]: 1, [spotKey("b")]: 2, [spotKey("c")]: 3, [spotKey("d")]: 4 });
    const out = planRoute(baseInput(spots, matrix, { lunchBreak: true }));
    const lunch = out.items.find((i) => i.type === "lunch");
    expect(lunch).toBeDefined();
    expect(hhmmToMinutes(lunch!.arrive)).toBeGreaterThanOrEqual(hhmmToMinutes("11:30"));
    expect(hhmmToMinutes(lunch!.arrive)).toBeLessThanOrEqual(hhmmToMinutes("13:30"));
    expect(lunch!.stayMin).toBe(60);
  });

  it("その日が定休日のスポットは opening_hours で外れる", () => {
    // 2026-11-03 は火曜（曜日 2）
    const spots = [spot("a"), spot("b", { openingHours: { "2": null } })];
    const matrix = lineMatrix({ [ORIGIN_KEY]: 0, [spotKey("a")]: 1, [spotKey("b")]: 2 });
    const out = planRoute(baseInput(spots, matrix));
    expect(out.skipped).toEqual([{ spotId: "b", reason: "opening_hours" }]);
    expect(out.items).toHaveLength(1);
  });

  it("営業時間外にしか到着できないスポットは外れ、営業時間内に入る順を選ぶ", () => {
    // a は 10:00 開店。a を先にすると 09:10 到着で不可なので b → a の順になる
    const spots = [spot("a", { openingHours: { "2": { open: "10:00", close: "17:00" } } }), spot("b")];
    const matrix = lineMatrix({ [ORIGIN_KEY]: 0, [spotKey("a")]: 1, [spotKey("b")]: 2 });
    const out = planRoute(baseInput(spots, matrix));
    expect(out.skipped).toEqual([]);
    expect(out.items.map((i) => (i.type === "spot" ? i.spotId : "lunch"))).toEqual(["b", "a"]);
  });

  it("行列に区間が無いスポットは no_route で外れる", () => {
    const spots = [spot("a"), spot("b"), spot("c")];
    const matrix = lineMatrix({ [ORIGIN_KEY]: 0, [spotKey("a")]: 1, [spotKey("b")]: 2 });
    // c に関する区間は一切無い
    const out = planRoute(baseInput(spots, matrix));
    expect(out.skipped).toEqual([{ spotId: "c", reason: "no_route" }]);
    expect(out.items.map((i) => (i.type === "spot" ? i.spotId : "lunch"))).toEqual(["a", "b"]);
  });

  it("fixedOrder と stayOverrides を指定すると、その順・その滞在時間で計算する", () => {
    const spots = [spot("a"), spot("b")];
    const matrix = lineMatrix({ [ORIGIN_KEY]: 0, [spotKey("a")]: 1, [spotKey("b")]: 2 });
    const out = planRoute(baseInput(spots, matrix, { fixedOrder: ["b", "a"], stayOverrides: { b: 90 } }));
    expect(out.items.map((i) => (i.type === "spot" ? i.spotId : "lunch"))).toEqual(["b", "a"]);
    expect(out.items[0]).toMatchObject({ spotId: "b", arrive: "09:20", stayMin: 90, depart: "10:50", travelMinToNext: 10 });
  });

  it("10 か所でも 5 秒以内に終わる", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `s${i}`);
    const points: Record<string, [number, number]> = { [ORIGIN_KEY]: [0, 0] };
    ids.forEach((id, i) => {
      points[spotKey(id)] = [Math.cos(i) * 3 + 3, Math.sin(i * 1.7) * 3 + 3];
    });
    const matrix = planeMatrix(points);
    const spots = ids.map((id) => spot(id));
    const t0 = Date.now();
    const out = planRoute(baseInput(spots, matrix, { lunchBreak: true, endMin: hhmmToMinutes("15:00") }));
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(out.items.length + out.skipped.length).toBeGreaterThanOrEqual(10);
    expect(hhmmToMinutes(out.endAt)).toBeLessThanOrEqual(hhmmToMinutes("15:00"));
  });
});
