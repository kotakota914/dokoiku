import { describe, expect, it } from "vitest";
import type { PlanParams, PlanResult } from "@/lib/domain/types";
import { normalizePlanParams, normalizePlanResult, statsFromItems } from "./normalize";

/** v0.1 形式の保存済みプラン（method / preferences / next / stats が無い） */
const OLD_PARAMS = {
  listId: "list-1",
  spotIds: ["a", "b"],
  origin: { lat: 36.578, lng: 136.6478, label: "金沢駅" },
  destination: null,
  date: "2026-11-03",
  startTime: "09:00",
  endTime: "18:00",
  mode: "walking",
  pace: "relaxed",
  interests: ["gourmet"],
  lunchBreak: false,
};

const OLD_RESULT = {
  items: [
    {
      type: "spot",
      spotId: "a",
      arrive: "09:30",
      stayMin: 60,
      depart: "10:30",
      travelMinToNext: 20,
      inBestTime: true,
    },
    { type: "lunch", arrive: "12:00", stayMin: 60, depart: "13:00", travelMinToNext: 10 },
    {
      type: "spot",
      spotId: "b",
      arrive: "13:10",
      stayMin: 60,
      depart: "14:10",
      travelMinToNext: null,
      inBestTime: false,
    },
  ],
  skipped: [{ spotId: "c", reason: "time_limit" }],
  totalTravelMin: 30,
  endAt: "14:10",
  geometry: null,
  travelMatrixId: "tm_old",
  estimated: true,
};

describe("normalizePlanParams", () => {
  it("v0.1 の pace / interests を preferences へ移し、method は auto にする", () => {
    const p = normalizePlanParams(OLD_PARAMS);
    expect(p.method).toBe("auto");
    expect(p.preferences).toEqual({
      pace: "relaxed",
      interests: ["gourmet"],
      priority: "fewer_moves",
      timeWindows: [],
      orderHints: [],
      exclude: [],
    });
    expect(p.mode).toBe("walking");
    expect(p.spotIds).toEqual(["a", "b"]);
    expect("pace" in p).toBe(false);
  });

  it("v0.3 の形はそのまま保つ", () => {
    const params: PlanParams = {
      ...normalizePlanParams(OLD_PARAMS),
      method: "chat",
      preferences: {
        pace: "packed",
        interests: [],
        priority: "best_time",
        timeWindows: [{ spotId: "a", from: "10:00", to: "11:00" }],
        orderHints: [{ spotId: "b", position: "last" }],
        exclude: ["c"],
      },
    };
    expect(normalizePlanParams(params)).toEqual(params);
  });

  it("壊れた値は既定値にする", () => {
    const p = normalizePlanParams({ mode: "bicycle" });
    expect(p.mode).toBe("transit");
    expect(p.method).toBe("auto");
    expect(p.lunchBreak).toBe(false);
  });
});

describe("normalizePlanResult", () => {
  it("v0.1 の結果に候補の項目・区間・統計を補う", () => {
    const r = normalizePlanResult(OLD_RESULT, { mode: "walking" });
    expect(r.id).toBe("c1");
    expect(r.kind).toBe("fewest_moves");
    expect(r.label).toBe("移動が最も少ない案");
    expect(r.reason).toBe("");
    expect(r.notes).toEqual([]);
    expect(r.items).toHaveLength(3);
    // 区間は travelMinToNext から補う（最後は null）
    expect(r.items[0].next).toEqual({ mode: "walking", travelMin: 20, estimated: true, walkM: null });
    expect(r.items[1].next).toEqual({ mode: "walking", travelMin: 10, estimated: true, walkM: null });
    expect(r.items[2].next).toBeNull();
    expect(r.items[0].travelMinToNext).toBe(20);
    expect(r.stats).toEqual({ spotCount: 2, totalTravelMin: 30, walkM: 0, endAt: "14:10", bestTimeHits: 1 });
    expect(r.totalTravelMin).toBe(30);
    expect(r.endAt).toBe("14:10");
    expect(r.travelMatrixId).toBe("tm_old");
    expect(r.estimated).toBe(true);
    expect(r.skipped).toEqual([{ spotId: "c", reason: "time_limit" }]);
  });

  it("v0.3 の形はそのまま保つ", () => {
    const result: PlanResult = {
      id: "c2",
      kind: "most_spots",
      label: "回れる場所が最も多い案",
      reason: "移動 40 分",
      items: [
        {
          type: "spot",
          spotId: "a",
          arrive: "09:30",
          stayMin: 60,
          depart: "10:30",
          travelMinToNext: 25,
          next: { mode: "transit", travelMin: 25, estimated: false, walkM: 400 },
          inBestTime: true,
        },
        {
          type: "spot",
          spotId: "b",
          arrive: "10:55",
          stayMin: 45,
          depart: "11:40",
          travelMinToNext: null,
          next: null,
          inBestTime: false,
        },
      ],
      skipped: [],
      notes: ["一部の区間は徒歩で計算しています"],
      stats: { spotCount: 2, totalTravelMin: 25, walkM: 400, endAt: "11:40", bestTimeHits: 1 },
      geometry: {
        type: "LineString",
        coordinates: [
          [136.65, 36.56],
          [136.66, 36.57],
        ],
      },
      totalTravelMin: 25,
      endAt: "11:40",
      travelMatrixId: "tm_new",
      estimated: false,
    };
    expect(normalizePlanResult(result, { mode: "transit" })).toEqual(result);
  });

  it("items が無くても空の結果を返す", () => {
    const r = normalizePlanResult({});
    expect(r.items).toEqual([]);
    expect(r.stats).toEqual({ spotCount: 0, totalTravelMin: 0, walkM: 0, endAt: "", bestTimeHits: 0 });
    expect(r.geometry).toBeNull();
  });
});

describe("statsFromItems", () => {
  it("区間の合計・歩く距離・時間帯の件数を数える", () => {
    const r = normalizePlanResult(OLD_RESULT, { mode: "driving" });
    const stats = statsFromItems(r.items, null, null);
    expect(stats).toEqual({ spotCount: 2, totalTravelMin: 30, walkM: 0, endAt: "14:10", bestTimeHits: 1 });
  });
});
