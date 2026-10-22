import { describe, expect, it } from "vitest";
import type { PlanItem } from "@/lib/domain/types";
import { buildRouteStops } from "./route";

describe("buildRouteStops", () => {
  const items: PlanItem[] = [
    {
      type: "spot",
      spotId: "a",
      arrive: "09:30",
      stayMin: 60,
      depart: "10:30",
      travelMinToNext: 20,
      next: { mode: "walking", travelMin: 20, estimated: false, walkM: 1500 },
      inBestTime: true,
    },
    {
      type: "lunch",
      arrive: "11:30",
      stayMin: 60,
      depart: "12:30",
      travelMinToNext: 10,
      next: { mode: "walking", travelMin: 10, estimated: false, walkM: 700 },
    },
    {
      type: "spot",
      spotId: "b",
      arrive: "12:40",
      stayMin: 45,
      depart: "13:25",
      travelMinToNext: null,
      next: null,
      inBestTime: false,
    },
    {
      type: "spot",
      spotId: "deleted",
      arrive: "13:40",
      stayMin: 30,
      depart: "14:10",
      travelMinToNext: null,
      next: null,
      inBestTime: false,
    },
  ];
  const spotsById = new Map([
    ["a", { lat: 35, lng: 135, name: "A" }],
    ["b", { lat: 35.1, lng: 135.1, name: "B" }],
  ]);

  it("出発地・番号付きスポット・到着地の順。昼食と不明スポットは飛ばす", () => {
    const stops = buildRouteStops({
      origin: { lat: 34.9, lng: 134.9, label: "京都駅" },
      destination: { lat: 34.95, lng: 134.95, label: "" },
      items,
      spotsById,
    });
    expect(stops.map((s) => [s.kind, s.label])).toEqual([
      ["origin", "発"],
      ["spot", "1"],
      ["spot", "2"],
      ["destination", "着"],
    ]);
    expect(stops[0].name).toBe("京都駅");
    expect(stops[1].spotId).toBe("a");
    expect(stops[3].name).toBe("到着地");
  });

  it("到着地が無ければ出発地とスポットのみ", () => {
    const stops = buildRouteStops({
      origin: { lat: 0, lng: 0, label: "" },
      destination: null,
      items,
      spotsById,
    });
    expect(stops).toHaveLength(3);
    expect(stops[0].name).toBe("出発地");
  });
});
