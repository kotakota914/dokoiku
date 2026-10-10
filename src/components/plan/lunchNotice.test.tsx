// @vitest-environment jsdom
/**
 * S-09 PlanResultView：昼食休憩を希望したのに 11:30〜13:30 に空きが無く入らなかったときの案内（F-5-1）。
 * 判定は planner の isLunchSkipped と同じ（PlanResult に項目は増やさない）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { PlanParams, PlanResult, SpotSummary } from "@/lib/domain/types";
import { ToastProvider } from "@/components/ui/Toast";
import { PlanResultView } from "./PlanResultView";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
}));

// RouteMap は maplibre-gl を含むため差し替える
vi.mock("@/components/map", () => ({
  RouteMap: () => <div data-testid="route-map" />,
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function wrap(ui: ReactNode) {
  return <ToastProvider>{ui}</ToastProvider>;
}

const LIST_ID = "11111111-1111-4111-8111-111111111111";
const S1 = "22222222-2222-4222-8222-222222222221";

const spots: SpotSummary[] = [
  {
    id: S1,
    name: "伏見稲荷大社",
    lat: 34.9671,
    lng: 135.7727,
    category: "history",
    postCount: 10,
    likeCount: 1,
    popularity: "popular",
    coverThumbUrl: null,
    prefecture: "京都府",
    city: "京都市",
  },
];

const params: PlanParams = {
  listId: LIST_ID,
  spotIds: [S1],
  origin: { lat: 34.9858, lng: 135.7588, label: "京都駅" },
  destination: null,
  date: "2026-11-03",
  startTime: "09:00",
  endTime: "18:00",
  mode: "walking",
  pace: "normal",
  interests: [],
  lunchBreak: true,
};

/** 09:25 到着・滞在 255 分 → 13:40 出発。11:30〜13:30 を跨ぐ滞在なので昼食が入らない */
const noLunch: PlanResult = {
  items: [
    {
      type: "spot",
      spotId: S1,
      arrive: "09:25",
      stayMin: 255,
      depart: "13:40",
      travelMinToNext: null,
      inBestTime: true,
    },
  ],
  skipped: [],
  totalTravelMin: 25,
  endAt: "13:40",
  geometry: null,
  travelMatrixId: "tm_test",
  estimated: false,
};

describe("PlanResultView（昼食休憩の案内）", () => {
  it("昼食を希望したのに入らなかったときは案内を出す", () => {
    render(wrap(<PlanResultView params={params} result={noLunch} spots={spots} listId={LIST_ID} />));
    expect(screen.getByText(/昼食休憩を入れられませんでした/)).toHaveTextContent(
      "昼食休憩を入れられませんでした（11:30〜13:30 の間に空きがありません）",
    );
  });

  it("昼食が入っているとき・昼食を希望していないときは案内を出さない", () => {
    const withLunch: PlanResult = {
      ...noLunch,
      items: [
        {
          type: "spot",
          spotId: S1,
          arrive: "09:25",
          stayMin: 60,
          depart: "10:25",
          travelMinToNext: 0,
          inBestTime: true,
        },
        { type: "lunch", arrive: "11:30", stayMin: 60, depart: "12:30", travelMinToNext: null },
      ],
      endAt: "12:30",
    };
    const { unmount } = render(
      wrap(<PlanResultView params={params} result={withLunch} spots={spots} listId={LIST_ID} />),
    );
    expect(screen.queryByText(/昼食休憩を入れられませんでした/)).not.toBeInTheDocument();
    unmount();

    render(
      wrap(
        <PlanResultView
          params={{ ...params, lunchBreak: false }}
          result={noLunch}
          spots={spots}
          listId={LIST_ID}
        />,
      ),
    );
    expect(screen.queryByText(/昼食休憩を入れられませんでした/)).not.toBeInTheDocument();
  });
});
