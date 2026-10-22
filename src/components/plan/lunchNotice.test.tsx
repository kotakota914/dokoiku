// @vitest-environment jsdom
/**
 * PlanDetail（S-11 / S-12 共用）：昼食休憩を希望したのに 11:30〜13:30 に空きが無く入らなかったときの案内。
 * 判定は planner の isLunchSkipped と同じ。planner が notes に同じ案内を入れているときは二重に出さない。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { PlanCandidate } from "@/lib/domain/types";
import type { TimelineSpot } from "./Timeline";
import { PlanDetail } from "./PlanDetail";
import { S1, candidateA, params, spots } from "./testFixtures";

// RouteMap は maplibre-gl を含むため差し替える
vi.mock("@/components/map", () => ({
  RouteMap: () => <div data-testid="route-map" />,
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  cleanup();
});

const spotsById = new Map<string, TimelineSpot>(
  spots.map((s) => [s.id, { id: s.id, name: s.name, lat: s.lat, lng: s.lng }]),
);

/** 09:25 到着・滞在 255 分 → 13:40 出発。11:30〜13:30 を跨ぐ滞在なので昼食が入らない */
const noLunch: PlanCandidate = {
  ...candidateA,
  items: [
    {
      type: "spot",
      spotId: S1,
      arrive: "09:25",
      stayMin: 255,
      depart: "13:40",
      travelMinToNext: null,
      next: null,
      inBestTime: true,
    },
  ],
  skipped: [],
  notes: [],
  stats: { spotCount: 1, totalTravelMin: 25, walkM: 1800, endAt: "13:40", bestTimeHits: 1 },
};

const LUNCH_TEXT = "昼食休憩を入れられませんでした（11:30〜13:30 の間に空きがありません）";

describe("PlanDetail（昼食休憩の案内）", () => {
  it("昼食を希望したのに入らなかったときは案内を出す", () => {
    render(<PlanDetail params={params} candidate={noLunch} spotsById={spotsById} />);
    expect(screen.getByText(/昼食休憩を入れられませんでした/)).toHaveTextContent(LUNCH_TEXT);
  });

  it("昼食が入っているとき・希望していないとき・notes に同じ案内があるときは出さない", () => {
    const { unmount } = render(<PlanDetail params={params} candidate={candidateA} spotsById={spotsById} />);
    expect(screen.queryByText(/昼食休憩を入れられませんでした/)).not.toBeInTheDocument();
    unmount();

    const second = render(
      <PlanDetail params={{ ...params, lunchBreak: false }} candidate={noLunch} spotsById={spotsById} />,
    );
    expect(screen.queryByText(/昼食休憩を入れられませんでした/)).not.toBeInTheDocument();
    second.unmount();

    render(
      <PlanDetail
        params={params}
        candidate={{ ...noLunch, notes: ["11:30〜13:30 に昼食休憩を入れる空きがありませんでした"] }}
        spotsById={spotsById}
      />,
    );
    expect(screen.queryByText(/昼食休憩を入れられませんでした/)).not.toBeInTheDocument();
    expect(screen.getByText("11:30〜13:30 に昼食休憩を入れる空きがありませんでした")).toBeInTheDocument();
  });
});
