// @vitest-environment jsdom
/**
 * S-09 部品の単体テスト（fetch をモック）：
 * - Timeline：items の順に描画し、移動時間と Google マップのリンク（travelmode=transit）を出す
 * - PlanResultView：skipped の理由文言、上下ボタンで order を入れ替えて POST /plans/recompute を呼ぶ
 * - planSession：sessionStorage の保存・読み出し
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { PlanParams, PlanResult, SpotSummary } from "@/lib/domain/types";
import { ToastProvider } from "@/components/ui/Toast";
import { Timeline, type TimelineSpot } from "./Timeline";
import { PlanResultView } from "./PlanResultView";
import { loadPlanSession, planSessionKey, savePlanSession } from "./planSession";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
}));

// RouteMap は maplibre-gl を含むため差し替える
vi.mock("@/components/map", () => ({
  RouteMap: ({ stops }: { stops: { label: string }[] }) => (
    <div data-testid="route-map">{stops.map((s) => s.label).join(",")}</div>
  ),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  push.mockReset();
  window.sessionStorage.clear();
});

function wrap(ui: ReactNode) {
  return <ToastProvider>{ui}</ToastProvider>;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const LIST_ID = "11111111-1111-4111-8111-111111111111";
const S1 = "22222222-2222-4222-8222-222222222221";
const S2 = "22222222-2222-4222-8222-222222222222";
const S3 = "22222222-2222-4222-8222-222222222223";

const spots: SpotSummary[] = [
  {
    id: S1,
    name: "兼六園",
    lat: 36.5619,
    lng: 136.6625,
    category: "history",
    postCount: 10,
    likeCount: 1,
    popularity: "popular",
    coverThumbUrl: null,
    prefecture: "石川県",
    city: "金沢市",
  },
  {
    id: S2,
    name: "金沢城公園",
    lat: 36.5649,
    lng: 136.659,
    category: "history",
    postCount: 3,
    likeCount: 0,
    popularity: "normal",
    coverThumbUrl: null,
    prefecture: "石川県",
    city: "金沢市",
  },
  {
    id: S3,
    name: "ひがし茶屋街",
    lat: 36.5725,
    lng: 136.6672,
    category: "nature",
    postCount: 1,
    likeCount: 0,
    popularity: "normal",
    coverThumbUrl: null,
    prefecture: "石川県",
    city: "金沢市",
  },
];

const params: PlanParams = {
  listId: LIST_ID,
  spotIds: [S1, S2, S3],
  origin: { lat: 36.578, lng: 136.6478, label: "金沢駅" },
  destination: null,
  date: "2026-11-03",
  startTime: "09:00",
  endTime: "18:00",
  mode: "walking",
  pace: "normal",
  interests: [],
  lunchBreak: true,
};

const result: PlanResult = {
  items: [
    {
      type: "spot",
      spotId: S1,
      arrive: "09:25",
      stayMin: 60,
      depart: "10:25",
      travelMinToNext: 18,
      inBestTime: true,
    },
    {
      type: "spot",
      spotId: S2,
      arrive: "10:43",
      stayMin: 45,
      depart: "11:28",
      travelMinToNext: 2,
      inBestTime: false,
    },
    { type: "lunch", arrive: "11:30", stayMin: 60, depart: "12:30", travelMinToNext: null },
  ],
  skipped: [{ spotId: S3, reason: "time_limit" }],
  totalTravelMin: 45,
  endAt: "12:30",
  geometry: null,
  travelMatrixId: "tm_test",
  estimated: true,
};

function spotsById(): Map<string, TimelineSpot> {
  return new Map(spots.map((s) => [s.id, { id: s.id, name: s.name, lat: s.lat, lng: s.lng }]));
}

describe("Timeline", () => {
  it("items の順に描画し、移動時間と Google マップのリンク（transit）を出す（F-5-4、F-5-8）", () => {
    render(
      <Timeline
        items={result.items}
        spotsById={spotsById()}
        origin={params.origin}
        destination={params.destination}
        startTime={params.startTime}
        endAt={result.endAt}
        mode="walking"
      />,
    );
    const list = screen.getByRole("list", { name: "訪問順" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("兼六園");
    expect(rows[0]).toHaveTextContent("到着 09:25〜出発 10:25");
    expect(rows[0]).toHaveTextContent("おすすめの時間帯");
    expect(rows[1]).toHaveTextContent("金沢城公園");
    expect(rows[2]).toHaveTextContent("昼食休憩");

    // 出発地→最初のスポットは開始時刻からの差、以降は travelMinToNext
    expect(rows[0]).toHaveTextContent("移動 約25分");
    expect(rows[1]).toHaveTextContent("移動 約18分");

    const links = screen.getAllByRole("link", { name: /Googleマップで経路を開く/ });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute(
      "href",
      "https://www.google.com/maps/dir/?api=1&origin=36.578,136.6478&destination=36.5619,136.6625&travelmode=transit",
    );
    expect(links[1].getAttribute("href")).toContain(
      "origin=36.5619,136.6625&destination=36.5649,136.659&travelmode=transit",
    );
    for (const a of links) expect(a).toHaveAttribute("target", "_blank");
  });

  it("到着直後に昼食が入るときは、昼食行に移動時間を出さず次のスポットの行にまとめる（F-5-8）", () => {
    // schedule.ts は [S1(travel=18), lunch(travel=0), S2] の形で返す
    const items: PlanResult["items"] = [
      {
        type: "spot",
        spotId: S1,
        arrive: "09:25",
        stayMin: 60,
        depart: "10:25",
        travelMinToNext: 18,
        inBestTime: false,
      },
      { type: "lunch", arrive: "10:43", stayMin: 60, depart: "11:43", travelMinToNext: 0 },
      {
        type: "spot",
        spotId: S2,
        arrive: "11:43",
        stayMin: 45,
        depart: "12:28",
        travelMinToNext: 30,
        inBestTime: false,
      },
    ];
    render(
      <Timeline
        items={items}
        spotsById={spotsById()}
        origin={params.origin}
        destination={{ lat: 36.56, lng: 136.65, label: "ホテル" }}
        startTime={params.startTime}
        endAt="12:58"
        mode="walking"
      />,
    );
    const rows = within(screen.getByRole("list", { name: "訪問順" })).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("移動 約25分");
    expect(rows[1]).toHaveTextContent("昼食休憩");
    expect(rows[1]).not.toHaveTextContent("移動");
    expect(rows[1].querySelector("a")).toBeNull();
    expect(rows[2]).toHaveTextContent("金沢城公園");
    expect(rows[2]).toHaveTextContent("移動 約18分");
    const links = screen.getAllByRole("link", { name: /Googleマップで経路を開く/ });
    expect(links).toHaveLength(3);
    expect(links[1].getAttribute("href")).toContain("origin=36.5619,136.6625&destination=36.5649,136.659");
    // 最後のスポット → 到着地
    expect(screen.getByText("移動 約30分")).toBeInTheDocument();
  });

  it("到着地があれば最後の区間のリンクを出す", () => {
    render(
      <Timeline
        items={result.items}
        spotsById={spotsById()}
        origin={params.origin}
        destination={{ lat: 36.56, lng: 136.65, label: "ホテル" }}
        startTime={params.startTime}
        endAt="13:00"
        mode="driving"
      />,
    );
    expect(screen.getByText("ホテル")).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: /Googleマップで経路を開く/ });
    expect(links).toHaveLength(3);
    expect(links[2].getAttribute("href")).toContain(
      "origin=36.5649,136.659&destination=36.56,136.65&travelmode=transit",
    );
  });
});

describe("PlanResultView", () => {
  it("入らなかった場所を理由つきで表示し、概算バッジを出す（F-5-5、ADR-0018）", () => {
    render(wrap(<PlanResultView params={params} result={result} spots={spots} listId={LIST_ID} />));
    expect(screen.getByRole("heading", { name: "時間が足りず入らなかった場所" })).toBeInTheDocument();
    expect(screen.getByText("ひがし茶屋街")).toBeInTheDocument();
    expect(screen.getByText("時間が足りません")).toBeInTheDocument();
    expect(screen.getByText("移動時間は概算です")).toBeInTheDocument();
    expect(screen.getByTestId("route-map")).toHaveTextContent("発,1,2");
  });

  it("他の理由の文言", () => {
    const r: PlanResult = {
      ...result,
      skipped: [
        { spotId: S3, reason: "no_route" },
        { spotId: S2, reason: "opening_hours" },
        { spotId: "33333333-3333-4333-8333-333333333333", reason: "deleted" },
      ],
    };
    render(wrap(<PlanResultView params={params} result={r} spots={spots} listId={LIST_ID} />));
    expect(screen.getByText("この区間の経路が見つかりませんでした")).toBeInTheDocument();
    expect(screen.getByText("営業時間外")).toBeInTheDocument();
    expect(screen.getByText("削除されました")).toBeInTheDocument();
    expect(screen.getByText("削除されたスポット")).toBeInTheDocument();
  });

  it("下へボタンで order を入れ替えて POST /plans/recompute を呼び、結果を差し替える（F-5-6）", async () => {
    const recomputed: PlanResult = {
      ...result,
      items: [
        {
          type: "spot",
          spotId: S2,
          arrive: "09:30",
          stayMin: 45,
          depart: "10:15",
          travelMinToNext: 18,
          inBestTime: false,
        },
        {
          type: "spot",
          spotId: S1,
          arrive: "10:33",
          stayMin: 60,
          depart: "11:33",
          travelMinToNext: null,
          inBestTime: false,
        },
      ],
      skipped: [],
      endAt: "11:33",
    };
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
        return jsonResponse(recomputed);
      }),
    );
    const onResultChange = vi.fn();
    render(
      wrap(
        <PlanResultView
          params={params}
          result={result}
          spots={spots}
          listId={LIST_ID}
          onResultChange={onResultChange}
        />,
      ),
    );

    expect(screen.getByRole("button", { name: "兼六園を上へ" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "兼六園を下へ" }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].url).toBe("/api/v1/plans/recompute");
    expect(calls[0].body).toEqual({ params, travelMatrixId: "tm_test", order: [S2, S1], stayOverrides: {} });

    await waitFor(() => {
      const rows = within(screen.getByRole("list", { name: "訪問順" })).getAllByRole("listitem");
      expect(rows[0]).toHaveTextContent("金沢城公園");
      expect(rows[1]).toHaveTextContent("兼六園");
    });
    expect(onResultChange).toHaveBeenCalledWith(recomputed);
    expect(screen.queryByRole("heading", { name: "時間が足りず入らなかった場所" })).not.toBeInTheDocument();
  });

  it("滞在時間の変更は stayOverrides に入れて再計算する", async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
        return jsonResponse(result);
      }),
    );
    render(wrap(<PlanResultView params={params} result={result} spots={spots} listId={LIST_ID} />));
    fireEvent.click(screen.getAllByRole("button", { name: "変更" })[0]);
    fireEvent.change(screen.getByRole("combobox", { name: "兼六園の滞在時間" }), {
      target: { value: "90" },
    });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual({
      params,
      travelMatrixId: "tm_test",
      order: [S1, S2],
      stayOverrides: { [S1]: 90 },
    });
  });

  it("再計算の結果が終了時刻を超えたら警告を出し、保存できない（F-5-6）", async () => {
    const over: PlanResult = { ...result, endAt: "18:40", skipped: [] };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(over)),
    );
    render(wrap(<PlanResultView params={params} result={result} spots={spots} listId={LIST_ID} />));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "兼六園を下へ" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("終了時刻 18:00 を超えています（終了 18:40）");
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  });

  it("保存で POST /plans を呼び、保存済みページへ移動する（F-5-7）", async () => {
    const calls: { url: string; method?: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, method: init?.method });
        return jsonResponse({
          id: "plan-1",
          wishlistId: LIST_ID,
          date: params.date,
          spotCount: 2,
          totalTravelMin: 45,
          createdAt: "",
          userId: "u",
          params,
          result,
        });
      }),
    );
    render(wrap(<PlanResultView params={params} result={result} spots={spots} listId={LIST_ID} />));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/plans/plan-1"));
    expect(calls[0]).toEqual({ url: "/api/v1/plans", method: "POST" });
  });

  it("保存済み表示では並び替えボタンが無く、削除で DELETE /plans/{id} を呼ぶ", async () => {
    const calls: { url: string; method?: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, method: init?.method });
        return new Response(null, { status: 204 });
      }),
    );
    render(
      wrap(
        <PlanResultView
          params={params}
          result={result}
          spots={spots}
          listId={LIST_ID}
          saved={{ planId: "plan-1" }}
        />,
      ),
    );
    expect(screen.queryByRole("button", { name: "兼六園を下へ" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "削除" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/lists/${LIST_ID}`));
    expect(calls[0]).toEqual({ url: "/api/v1/plans/plan-1", method: "DELETE" });
  });
});

describe("planSession", () => {
  it("sessionStorage に保存して読み戻せる", () => {
    expect(loadPlanSession(LIST_ID)).toBeNull();
    expect(savePlanSession(LIST_ID, { params, result, spots })).toBe(true);
    expect(window.sessionStorage.getItem(planSessionKey(LIST_ID))).not.toBeNull();
    expect(loadPlanSession(LIST_ID)).toEqual({ params, result, spots });
  });

  it("壊れた値は null にする", () => {
    window.sessionStorage.setItem(planSessionKey(LIST_ID), "{bad json");
    expect(loadPlanSession(LIST_ID)).toBeNull();
    window.sessionStorage.setItem(planSessionKey(LIST_ID), JSON.stringify({ params: {} }));
    expect(loadPlanSession(LIST_ID)).toBeNull();
  });
});
