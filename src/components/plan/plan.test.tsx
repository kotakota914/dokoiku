// @vitest-environment jsdom
/**
 * S-11 / S-12 部品の単体テスト（fetch をモック）：
 * - Timeline：items の順、区間の移動手段と移動時間、「目安」、保存前はナビを出さない
 * - PlanCompareView（S-11）：比較表、案の切り替え、空の候補、並び替え → POST /plans/recompute、保存
 * - PlanResultView（S-12）：各区間の「ナビを開始」、削除
 * - planSession：sessionStorage の保存・読み出し
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Plan, PlanResult } from "@/lib/domain/types";
import { ToastProvider } from "@/components/ui/Toast";
import { Timeline, type TimelineSpot } from "./Timeline";
import { PlanCompareView } from "./PlanResultPage";
import { PlanResultView } from "./PlanResultView";
import {
  loadPlanDraft,
  loadPlanSession,
  planSessionKey,
  savePlanDraft,
  savePlanSession,
  type PlanSession,
} from "./planSession";
import {
  LIST_ID,
  S1,
  S2,
  asResult,
  candidateA,
  computeResponse,
  jsonResponse,
  params,
  spots,
  urlOf,
} from "./testFixtures";

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

function spotsById(): Map<string, TimelineSpot> {
  return new Map(spots.map((s) => [s.id, { id: s.id, name: s.name, lat: s.lat, lng: s.lng }]));
}

const session: PlanSession = { params, response: computeResponse, spots, selectedId: null };

function captureFetch(respond: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; method?: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input);
      calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : null });
      return respond(url, init);
    }),
  );
  return calls;
}

describe("Timeline", () => {
  it("items の順に描画し、区間の移動手段と移動時間を出す。保存前はナビを出さない（F-5-8、F-5-12）", () => {
    render(
      <Timeline
        items={candidateA.items}
        spotsById={spotsById()}
        origin={params.origin}
        destination={params.destination}
        startTime={params.startTime}
        endAt={candidateA.stats.endAt}
        mode="walking"
      />,
    );
    const rows = within(screen.getByRole("list", { name: "訪問順" })).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("兼六園");
    expect(rows[0]).toHaveTextContent("到着 09:25〜出発 10:25");
    expect(rows[0]).toHaveTextContent("おすすめの時間帯");
    expect(rows[1]).toHaveTextContent("金沢城公園");
    expect(rows[2]).toHaveTextContent("昼食休憩");
    // 出発地→最初のスポットは開始時刻からの差、以降は next.travelMin
    expect(rows[0]).toHaveTextContent("徒歩のみで移動 約25分");
    expect(rows[1]).toHaveTextContent("徒歩のみで移動 約18分");
    expect(rows[1]).not.toHaveTextContent("目安");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText("ナビを開始")).not.toBeInTheDocument();
  });

  it("公共交通・概算の区間は「目安」と表示する", () => {
    const items: PlanResult["items"] = [
      {
        ...candidateA.items[0],
        next: { mode: "transit", travelMin: 12, estimated: true, walkM: 300 },
      } as PlanResult["items"][number],
      candidateA.items[1],
    ];
    render(
      <Timeline
        items={items}
        spotsById={spotsById()}
        origin={params.origin}
        destination={null}
        startTime={params.startTime}
        endAt="11:28"
        mode="transit"
      />,
    );
    const rows = within(screen.getByRole("list", { name: "訪問順" })).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("移動 約25分（目安）");
    expect(rows[1]).toHaveTextContent("公共交通＋徒歩で移動 約12分（目安）");
  });

  it("到着直後に昼食が入るときは、昼食行に移動時間を出さず次のスポットの行にまとめる", () => {
    const items: PlanResult["items"] = [
      {
        ...candidateA.items[0],
        next: { mode: "walking", travelMin: 18, estimated: false, walkM: null },
      } as PlanResult["items"][number],
      { type: "lunch", arrive: "10:43", stayMin: 60, depart: "11:43", travelMinToNext: 0, next: null },
      {
        type: "spot",
        spotId: S2,
        arrive: "11:43",
        stayMin: 45,
        depart: "12:28",
        travelMinToNext: 30,
        next: { mode: "walking", travelMin: 30, estimated: false, walkM: null },
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
    expect(rows[1]).toHaveTextContent("昼食休憩");
    expect(rows[1]).not.toHaveTextContent("移動");
    expect(rows[2]).toHaveTextContent("移動 約18分");
    expect(screen.getByText("ホテル")).toBeInTheDocument();
    expect(screen.getByText(/移動 約30分/)).toBeInTheDocument();
  });
});

describe("PlanCompareView（S-11）", () => {
  it("比較表に案ごとの数値・理由・注意書きを並べ、先頭の案を表示する（F-5-6、F-5-7）", () => {
    render(wrap(<PlanCompareView listId={LIST_ID} session={session} />));
    const compare = screen.getByRole("list", { name: "経路案" });
    const cards = within(compare)
      .getAllByRole("listitem")
      .filter((el) => el.parentElement === compare);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent("移動が最も少ない案");
    expect(cards[0]).toHaveTextContent("近い場所どうしをまとめ");
    expect(cards[0]).toHaveTextContent("回れる場所2か所");
    expect(cards[0]).toHaveTextContent("合計移動時間約45分");
    expect(cards[0]).toHaveTextContent("歩く距離約2.8km");
    expect(cards[0]).toHaveTextContent("終了時刻12:30");
    expect(cards[0]).toHaveTextContent("おすすめの時間帯に合う場所1か所");
    expect(cards[0]).toHaveTextContent("入らなかった場所ひがし茶屋街");
    expect(cards[1]).toHaveTextContent("入らなかった場所なし");
    expect(cards[1]).toHaveTextContent("移動時間は直線距離からの概算です");

    expect(screen.getByRole("button", { name: "表示中（移動が最も少ない案）" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("heading", { name: "時間が足りず入らなかった場所" })).toBeInTheDocument();
    expect(screen.getByText("時間が足りません")).toBeInTheDocument();
    expect(screen.getByTestId("route-map")).toHaveTextContent("発,1,2");
    // 保存前の案にはナビを置かない（ADR-0016）
    expect(screen.queryByText("ナビを開始")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "この案を保存" })).toBeEnabled();
  });

  it("別の案を選ぶとタイムラインと地図が切り替わり、選択を sessionStorage に残す", () => {
    const onSessionChange = vi.fn();
    render(wrap(<PlanCompareView listId={LIST_ID} session={session} onSessionChange={onSessionChange} />));
    fireEvent.click(screen.getByRole("button", { name: "この案を見る（回れる場所が最も多い案）" }));
    const rows = within(screen.getByRole("list", { name: "訪問順" })).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("ひがし茶屋街");
    expect(screen.getByTestId("route-map")).toHaveTextContent("発,1,2,3");
    expect(screen.getByText("移動時間は目安です")).toBeInTheDocument();
    expect(onSessionChange).toHaveBeenCalledWith(expect.objectContaining({ selectedId: "c2" }));
  });

  it("候補が空なら案内と「条件を変える」を出す", () => {
    render(
      wrap(
        <PlanCompareView
          listId={LIST_ID}
          session={{ ...session, response: { candidates: [], travelMatrixId: "tm" } }}
        />,
      ),
    );
    expect(screen.getByText("終了時刻を延ばすか、スポットを減らしてください")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "条件を変える" })).toHaveAttribute(
      "href",
      `/lists/${LIST_ID}/plan`,
    );
    expect(screen.queryByRole("button", { name: "この案を保存" })).not.toBeInTheDocument();
  });

  it("下へボタンで POST /plans/recompute を呼び、選んだ案を差し替える（F-5-10）", async () => {
    const recomputed = asResult({
      ...candidateA,
      id: "server-id",
      items: [candidateA.items[1], candidateA.items[0]],
      skipped: [],
      stats: { ...candidateA.stats, endAt: "11:33" },
    });
    const calls = captureFetch(() => jsonResponse(recomputed));
    const onSessionChange = vi.fn();
    render(wrap(<PlanCompareView listId={LIST_ID} session={session} onSessionChange={onSessionChange} />));

    expect(screen.getByRole("button", { name: "兼六園を上へ" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "兼六園を下へ" }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].url).toBe("/api/v1/plans/recompute");
    expect(calls[0].body).toEqual({
      params,
      travelMatrixId: "tm_test",
      order: [S2, S1],
      stayOverrides: {},
      candidate: { id: "c1", kind: "fewest_moves", label: "移動が最も少ない案" },
    });
    await waitFor(() => {
      const rows = within(screen.getByRole("list", { name: "訪問順" })).getAllByRole("listitem");
      expect(rows[0]).toHaveTextContent("金沢城公園");
    });
    // 選択中の案の id はそのまま
    expect(screen.getByRole("button", { name: "表示中（移動が最も少ない案）" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "時間が足りず入らなかった場所" })).not.toBeInTheDocument();
    const saved = onSessionChange.mock.calls.at(-1)?.[0] as PlanSession;
    expect(saved.response.candidates[0].id).toBe("c1");
  });

  it("滞在時間の変更は stayOverrides に入れて再計算する", async () => {
    const calls = captureFetch(() => jsonResponse(asResult(candidateA)));
    render(wrap(<PlanCompareView listId={LIST_ID} session={session} />));
    fireEvent.click(screen.getAllByRole("button", { name: "変更" })[0]);
    fireEvent.change(screen.getByRole("combobox", { name: "兼六園の滞在時間" }), { target: { value: "90" } });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toMatchObject({ order: [S1, S2], stayOverrides: { [S1]: 90 } });
  });

  it("再計算の結果が終了時刻を超えたら警告を出し、保存できない", async () => {
    captureFetch(() =>
      jsonResponse(asResult({ ...candidateA, skipped: [], stats: { ...candidateA.stats, endAt: "18:40" } })),
    );
    render(wrap(<PlanCompareView listId={LIST_ID} session={session} />));
    fireEvent.click(screen.getByRole("button", { name: "兼六園を下へ" }));
    expect(await screen.findByText("終了時刻 18:00 を超えています（終了 18:40）")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "この案を保存" })).toBeDisabled();
  });

  it("再計算に失敗したら再試行できる", async () => {
    captureFetch(() =>
      jsonResponse({ error: { code: "INTERNAL_ERROR", message: "再計算できませんでした" } }, 500),
    );
    render(wrap(<PlanCompareView listId={LIST_ID} session={session} />));
    fireEvent.click(screen.getByRole("button", { name: "兼六園を下へ" }));
    expect(await screen.findByText("再計算できませんでした")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再試行" })).toBeInTheDocument();
  });

  it("「この案を保存」で選んだ案＋行列 ID を POST /plans し、保存済みページへ移動する（F-5-11）", async () => {
    const calls = captureFetch(() => jsonResponse({ id: "plan-1" }, 201));
    render(wrap(<PlanCompareView listId={LIST_ID} session={{ ...session, selectedId: "c2" }} />));
    fireEvent.click(screen.getByRole("button", { name: "この案を保存" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/plans/plan-1"));
    expect(calls[0]).toMatchObject({ url: "/api/v1/plans", method: "POST" });
    const body = calls[0].body as { params: unknown; result: PlanResult };
    expect(body.params).toEqual(params);
    expect(body.result).toMatchObject({
      id: "c2",
      kind: "most_spots",
      travelMatrixId: "tm_test",
      totalTravelMin: 55,
      endAt: "12:10",
      estimated: true,
    });
  });
});

describe("PlanResultView（S-12 保存済み）", () => {
  const plan: Plan = {
    id: "plan-1",
    wishlistId: LIST_ID,
    userId: "u1",
    date: params.date,
    spotCount: 2,
    totalTravelMin: 45,
    method: "auto",
    createdAt: "2026-10-22T10:00:00+09:00",
    params,
    result: asResult(candidateA),
  };

  it("各区間に「ナビを開始」を置き、Google マップを新しいタブで開く（F-5-12）", () => {
    render(wrap(<PlanResultView plan={plan} spots={spots} />));
    expect(screen.getByRole("heading", { name: "保存済みプラン" })).toBeInTheDocument();
    const navs = screen.getAllByRole("link", { name: /へのナビをGoogleマップで開く$/ });
    expect(navs).toHaveLength(2);
    expect(navs[0]).toHaveAccessibleName("金沢駅から兼六園へのナビをGoogleマップで開く");
    expect(navs[0]).toHaveAttribute(
      "href",
      "https://www.google.com/maps/dir/?api=1&origin=36.578,136.6478&destination=36.5619,136.6625&travelmode=walking",
    );
    expect(navs[0]).toHaveAttribute("target", "_blank");
    expect(navs[0]).toHaveAttribute("rel", "noopener noreferrer");
    expect(navs[1]).toHaveAccessibleName("兼六園から金沢城公園へのナビをGoogleマップで開く");
    expect(screen.queryByRole("button", { name: "兼六園を下へ" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "この案を保存" })).not.toBeInTheDocument();
  });

  it("API の segments があればそれを使い、Google マップ以外の URL は出さない", () => {
    render(
      wrap(
        <PlanResultView
          plan={plan}
          spots={spots}
          navSegments={[
            {
              fromIndex: -1,
              toIndex: 0,
              fromLabel: "金沢駅",
              toLabel: "兼六園",
              navUrl: "https://www.google.com/maps/dir/?api=1&origin=1,2&destination=3,4&travelmode=walking",
            },
            {
              fromIndex: 0,
              toIndex: 1,
              fromLabel: "兼六園",
              toLabel: "金沢城公園",
              navUrl: "https://evil.example/",
            },
          ]}
        />,
      ),
    );
    const navs = screen.getAllByRole("link", { name: /ナビをGoogleマップで開く$/ });
    expect(navs).toHaveLength(1);
    expect(navs[0].getAttribute("href")).toContain("origin=1,2");
  });

  it("v0.1 で保存したプラン（stats・next が無い）も表示できる", () => {
    const legacy = {
      ...plan,
      result: {
        items: [
          {
            type: "spot",
            spotId: S1,
            arrive: "09:25",
            stayMin: 60,
            depart: "10:25",
            travelMinToNext: null,
            inBestTime: false,
          },
        ],
        skipped: [],
        totalTravelMin: 25,
        endAt: "10:25",
        geometry: null,
        travelMatrixId: "tm",
        estimated: true,
      },
    } as unknown as Plan;
    render(wrap(<PlanResultView plan={legacy} spots={spots} />));
    expect(screen.getByText("兼六園")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /ナビをGoogleマップで開く$/ })).toHaveLength(1);
  });

  it("削除で DELETE /plans/{id} を呼び、リストへ戻る", async () => {
    const calls = captureFetch(() => new Response(null, { status: 204 }));
    render(wrap(<PlanResultView plan={plan} spots={spots} />));
    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "削除" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/lists/${LIST_ID}`));
    expect(calls[0]).toMatchObject({ url: "/api/v1/plans/plan-1", method: "DELETE" });
  });
});

describe("planSession", () => {
  it("結果を sessionStorage に保存して読み戻せる", () => {
    expect(loadPlanSession(LIST_ID)).toBeNull();
    expect(savePlanSession(LIST_ID, session)).toBe(true);
    expect(window.sessionStorage.getItem(planSessionKey(LIST_ID))).not.toBeNull();
    expect(loadPlanSession(LIST_ID)).toEqual(session);
  });

  it("壊れた値・古い形（result だけ）は null にする", () => {
    window.sessionStorage.setItem(planSessionKey(LIST_ID), "{bad json");
    expect(loadPlanSession(LIST_ID)).toBeNull();
    window.sessionStorage.setItem(
      planSessionKey(LIST_ID),
      JSON.stringify({ params, result: asResult(candidateA), spots }),
    );
    expect(loadPlanSession(LIST_ID)).toBeNull();
  });

  it("下書きを保存して読み戻せる（足りない条件は既定値で補う）", () => {
    savePlanDraft(LIST_ID, {
      spotIds: [S1],
      origin: params.origin,
      destination: null,
      date: "2026-11-03",
      startTime: "09:00",
      endTime: "18:00",
      mode: "transit",
      lunchBreak: false,
      method: "chat",
      preferences: { ...params.preferences, pace: "relaxed" },
    });
    const draft = loadPlanDraft(LIST_ID);
    expect(draft).toMatchObject({ spotIds: [S1], method: "chat", lunchBreak: false });
    expect(draft?.preferences.pace).toBe("relaxed");
  });
});
