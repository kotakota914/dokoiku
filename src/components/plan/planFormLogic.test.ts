/**
 * S-09 の純粋ロジック：初期選択（F-5-1）、preferences の組み立て（F-5-B）、停止中の無効化（F-8）。
 */
import { describe, expect, it } from "vitest";
import type { Feature } from "@/lib/domain/constants";
import {
  buildPreferences,
  effectiveMode,
  initialSpotSelection,
  isTransitEstimated,
  methodAvailability,
  modeAvailability,
  restoreSpotSelection,
  type StatusView,
} from "./planFormLogic";
import { spotId, systemStatus, wishlistItem } from "./testFixtures";

function items(n: number, mustVisit: number[] = []) {
  return Array.from({ length: n }, (_, i) =>
    wishlistItem(spotId(i + 1), `スポット${i + 1}`, {
      mustVisit: mustVisit.includes(i + 1),
      createdAt: `2026-10-01T09:${String(i).padStart(2, "0")}:00+09:00`,
    }),
  );
}

function view(suspended: Feature[] = [], caps = {}, loading = false): StatusView {
  return {
    status: systemStatus(caps),
    loading,
    isSuspended: (f) => suspended.includes(f),
  };
}

describe("initialSpotSelection（F-5-1）", () => {
  it("8 か所以下なら全選択（削除済みは除く）", () => {
    const list = [...items(5), wishlistItem(spotId(99), "削除", { deleted: true })];
    expect(initialSpotSelection(list)).toEqual(items(5).map((i) => i.spotId));
  });

  it("9 か所以上なら「必ず行きたい」を優先して 8 か所まで、残りは追加順", () => {
    const list = items(12, [10, 12]);
    const picked = initialSpotSelection(list);
    expect(picked).toHaveLength(8);
    expect(picked).toContain(spotId(10));
    expect(picked).toContain(spotId(12));
    expect(picked).toEqual([1, 2, 3, 4, 5, 6, 10, 12].map(spotId));
  });

  it("追加順は createdAt で決める", () => {
    const list = [
      wishlistItem(spotId(2), "後", { createdAt: "2026-10-02T00:00:00+09:00" }),
      wishlistItem(spotId(1), "先", { createdAt: "2026-10-01T00:00:00+09:00" }),
    ];
    expect(initialSpotSelection(list)).toEqual([spotId(1), spotId(2)]);
  });

  it("下書きの選択を復元する（無いもの・上限超えは除き、空なら初期選択）", () => {
    const list = items(10);
    expect(restoreSpotSelection(list, [spotId(3), "x", spotId(9)])).toEqual([spotId(3), spotId(9)]);
    expect(restoreSpotSelection(list, ["x"])).toHaveLength(8);
    expect(
      restoreSpotSelection(
        list,
        list.map((i) => i.spotId),
      ),
    ).toHaveLength(8);
  });
});

describe("buildPreferences（F-5-B）", () => {
  const chosen = {
    pace: "relaxed" as const,
    interests: ["gourmet" as const],
    priority: "more_spots" as const,
  };

  it("おまかせは既定値（移動を少なく・ふつう）", () => {
    expect(buildPreferences("auto", chosen)).toEqual({
      pace: "normal",
      interests: [],
      priority: "fewer_moves",
      timeWindows: [],
      orderHints: [],
      exclude: [],
    });
  });

  it("重視するものを選ぶは選んだ値", () => {
    expect(buildPreferences("preferences", chosen)).toMatchObject({
      pace: "relaxed",
      interests: ["gourmet"],
      priority: "more_spots",
      timeWindows: [],
    });
  });

  it("AIと相談は読み取った条件をそのまま使う", () => {
    const conditions = {
      pace: "packed" as const,
      interests: [],
      priority: "best_time" as const,
      timeWindows: [{ spotId: spotId(1), from: "16:00", to: "17:30" }],
      orderHints: [],
      exclude: [spotId(2)],
    };
    expect(buildPreferences("chat", chosen, conditions)).toEqual(conditions);
  });
});

describe("停止中・未設定（F-8）", () => {
  it("公共交通が停止中なら公共交通だけ無効、徒歩・車は使える。選択は使える移動手段に切り替える", () => {
    const modes = modeAvailability(view(["route_planning_transit"]));
    expect(modes.transit).toEqual({ disabled: true, reason: "現在、経路作成（公共交通）は利用できません" });
    expect(modes.walking.disabled).toBe(false);
    expect(effectiveMode("transit", modes)).toBe("walking");
  });

  it("route_planning が停止中なら徒歩・車を無効", () => {
    const modes = modeAvailability(view(["route_planning"]));
    expect(modes.walking.disabled).toBe(true);
    expect(modes.driving.disabled).toBe(true);
    expect(modes.transit.disabled).toBe(false);
    expect(effectiveMode("driving", modes)).toBe("transit");
  });

  it("AI が停止中・未設定なら「AIと相談」だけ無効", () => {
    expect(methodAvailability(view(["ai_chat"])).chat.disabled).toBe(true);
    const unconfigured = methodAvailability(view([], { ai: false }));
    expect(unconfigured.chat).toEqual({ disabled: true, reason: "現在、AIと相談は利用できません" });
    expect(unconfigured.auto.disabled).toBe(false);
    expect(unconfigured.preferences.disabled).toBe(false);
    // 読み込み中は無効にしない
    expect(methodAvailability(view([], { ai: false }, true)).chat.disabled).toBe(false);
  });

  it("公共交通のキー未設定は無効にせず概算の注記だけ", () => {
    expect(modeAvailability(view([], { transit: false })).transit.disabled).toBe(false);
    expect(isTransitEstimated(view([], { transit: false }))).toBe(true);
    expect(isTransitEstimated(view([], { transit: true }))).toBe(false);
  });
});
