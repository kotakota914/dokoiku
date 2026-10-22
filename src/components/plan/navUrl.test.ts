/**
 * 保存済みプランの「ナビを開始」の URL（F-5-12）。
 */
import { describe, expect, it } from "vitest";
import type { PlanItem } from "@/lib/domain/types";
import { buildNavSegments, isSafeNavUrl, navAriaLabel, navUrl } from "./navUrl";
import { stripEmoji } from "./stripEmoji";

const A = { id: "a", name: "兼六園", lat: 36.5619, lng: 136.6625 };
const B = { id: "b", name: "金沢城公園", lat: 36.5649, lng: 136.659 };
const origin = { lat: 36.578, lng: 136.6478, label: "金沢駅" };

function spotItem(spotId: string): PlanItem {
  return {
    type: "spot",
    spotId,
    arrive: "09:00",
    stayMin: 30,
    depart: "09:30",
    travelMinToNext: null,
    next: null,
    inBestTime: false,
  };
}
const lunch: PlanItem = {
  type: "lunch",
  arrive: "12:00",
  stayMin: 60,
  depart: "13:00",
  travelMinToNext: 0,
  next: null,
};

describe("navUrl", () => {
  it("Google マップの経路 URL を作る（travelmode は移動手段に合わせる）", () => {
    expect(navUrl(origin, A, "transit")).toBe(
      "https://www.google.com/maps/dir/?api=1&origin=36.578,136.6478&destination=36.5619,136.6625&travelmode=transit",
    );
    expect(navUrl(A, B, "walking")).toContain("travelmode=walking");
    expect(navUrl(A, B, "driving")).toContain("travelmode=driving");
  });

  it("Google マップ以外の URL は安全でないとみなす", () => {
    expect(isSafeNavUrl(navUrl(A, B, "walking"))).toBe(true);
    expect(isSafeNavUrl("https://evil.example/?https://www.google.com/maps/dir/")).toBe(false);
    expect(isSafeNavUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("buildNavSegments", () => {
  it("出発地→スポット→到着地の区間を作り、昼食と座標の分からないスポットは飛ばす", () => {
    const items = [spotItem("a"), lunch, spotItem("gone"), spotItem("b")];
    const segments = buildNavSegments(
      {
        params: { origin, destination: { lat: 36.56, lng: 136.65, label: "" }, mode: "transit" },
        result: { items },
      },
      [A, B],
    );
    expect(segments.map((s) => [s.fromIndex, s.toIndex, s.fromLabel, s.toLabel])).toEqual([
      [-1, 0, "金沢駅", "兼六園"],
      [0, 3, "兼六園", "金沢城公園"],
      [3, 4, "金沢城公園", "到着地"],
    ]);
    expect(segments[1].navUrl).toBe(navUrl(A, B, "transit"));
  });

  it("到着地が無ければ最後のスポットで終わる。出発地の名前が空なら「出発地」", () => {
    const segments = buildNavSegments(
      {
        params: { origin: { ...origin, label: "" }, destination: null, mode: "driving" },
        result: { items: [spotItem("a")] },
      },
      [A],
    );
    expect(segments).toHaveLength(1);
    expect(navAriaLabel(segments[0])).toBe("出発地から兼六園へのナビをGoogleマップで開く");
    expect(segments[0].navUrl).toContain("travelmode=driving");
  });
});

describe("stripEmoji", () => {
  it("絵文字・異体字セレクタ・ZWJ・国旗を取り除き、日本語はそのまま残す", () => {
    expect(stripEmoji("金沢港で夕日を見ましょう" + String.fromCodePoint(0x1f305))).toBe(
      "金沢港で夕日を見ましょう",
    );
    const mixed =
      String.fromCodePoint(0x2600, 0xfe0f, 0x20) +
      "晴れ " +
      String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x20, 0x1f1ef, 0x1f1f5);
    expect(stripEmoji(mixed)).toBe("晴れ");
    expect(stripEmoji("午前は兼六園、午後はひがし茶屋街（16:00〜）")).toBe(
      "午前は兼六園、午後はひがし茶屋街（16:00〜）",
    );
  });
});
