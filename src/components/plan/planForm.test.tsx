// @vitest-environment jsdom
/**
 * S-09 PlanForm / S-10 PlanChat の画面テスト（fetch をモック）：
 * - 8 か所の上限（チェック不可と案内）と初期選択
 * - 作り方の切り替えと POST /plans/compute の preferences
 * - 停止中・未設定の無効化
 * - AIと相談：条件の表示・修正、unclear、会話の上限、503
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { SystemStatusProvider } from "@/components/system/SystemStatusProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { LIMITS } from "@/lib/domain/constants";
import type { PlanChatResponse, SystemStatus } from "@/lib/domain/types";
import { PlanChat } from "./PlanChat";
import { PlanForm } from "./PlanForm";
import { loadPlanDraft, loadPlanSession, type PlanDraft } from "./planSession";
import {
  LIST_ID,
  S1,
  S2,
  S3,
  computeResponse,
  jsonResponse,
  params,
  spotId,
  suspendedFeature,
  systemStatus,
  urlOf,
  wishlist,
  wishlistItem,
} from "./testFixtures";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  push.mockReset();
  window.sessionStorage.clear();
});

type Call = { url: string; method?: string; body: unknown };

/** /system/status は status を返し、それ以外は handler に任せる */
function stubFetch(
  status: SystemStatus,
  handler: (url: string, body: unknown) => Response = () => jsonResponse({}),
) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input);
      if (url.endsWith("/system/status")) return jsonResponse(status);
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url, method: init?.method, body });
      return handler(url, body);
    }),
  );
  return calls;
}

function renderWithStatus(ui: ReactNode, status: SystemStatus) {
  return render(
    <SystemStatusProvider initialStatus={status}>
      <ToastProvider>{ui}</ToastProvider>
    </SystemStatusProvider>,
  );
}

const threeSpots = wishlist([
  wishlistItem(S1, "兼六園", { createdAt: "2026-10-01T09:00:00+09:00" }),
  wishlistItem(S2, "金沢城公園", { createdAt: "2026-10-01T09:01:00+09:00" }),
  wishlistItem(S3, "ひがし茶屋街", { createdAt: "2026-10-01T09:02:00+09:00" }),
]);

describe("PlanForm（S-09）", () => {
  it("9 か所以上は「必ず行きたい」優先で 8 か所を選び、残りは選べない（F-5-1）", () => {
    stubFetch(systemStatus());
    const list = wishlist(
      Array.from({ length: 10 }, (_, i) =>
        wishlistItem(spotId(i + 1), `スポット${i + 1}`, {
          mustVisit: i + 1 === 10,
          createdAt: `2026-10-01T09:0${i}:00+09:00`,
        }),
      ),
    );
    renderWithStatus(<PlanForm list={list} />, systemStatus());
    expect(screen.getByText("8 / 8か所")).toBeInTheDocument();
    expect(screen.getByText("経路を作れるのは8か所までです")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /スポット10/ })).toBeChecked();
    const nine = screen.getByRole("checkbox", { name: /スポット9/ });
    expect(nine).not.toBeChecked();
    expect(nine).toBeDisabled();

    // 1 つ外すと選べるようになり、案内が消える
    fireEvent.click(screen.getByRole("checkbox", { name: /^スポット1(?!0)/ }));
    expect(screen.getByText("7 / 8か所")).toBeInTheDocument();
    expect(nine).toBeEnabled();
    expect(screen.queryByText("経路を作れるのは8か所までです")).not.toBeInTheDocument();
  });

  it("初期値：出発地は拠点、移動手段は公共交通＋徒歩、作り方はおまかせ", () => {
    stubFetch(systemStatus());
    renderWithStatus(<PlanForm list={threeSpots} />, systemStatus());
    expect(screen.getByText("3 / 8か所")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "拠点" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getAllByText("金沢駅").length).toBeGreaterThan(0);
    expect(screen.getByRole("radio", { name: "公共交通＋徒歩" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /おまかせ/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("group", { name: "旅行のペース" })).not.toBeInTheDocument();
  });

  it("おまかせで POST /plans/compute を呼び、結果を保存して比較画面へ進む", async () => {
    const calls = stubFetch(systemStatus(), () => jsonResponse(computeResponse));
    renderWithStatus(<PlanForm list={threeSpots} />, systemStatus());
    fireEvent.click(screen.getByRole("button", { name: "経路案を作成" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/lists/${LIST_ID}/plan/result`));
    expect(calls[0].url).toBe("/api/v1/plans/compute");
    expect(calls[0].body).toMatchObject({
      listId: LIST_ID,
      spotIds: [S1, S2, S3],
      origin: { lat: 36.578, lng: 136.6478, label: "金沢駅" },
      mode: "transit",
      method: "auto",
      preferences: { pace: "normal", interests: [], priority: "fewer_moves" },
    });
    expect(loadPlanSession(LIST_ID)).toMatchObject({ selectedId: "c1", response: computeResponse });
    expect(loadPlanDraft(LIST_ID)).toMatchObject({ method: "auto", spotIds: [S1, S2, S3] });
  });

  it("「重視するものを選ぶ」で選択肢を出し、選んだ値を preferences に入れる（F-5-4）", async () => {
    const calls = stubFetch(systemStatus(), () => jsonResponse(computeResponse));
    renderWithStatus(<PlanForm list={threeSpots} />, systemStatus());
    fireEvent.click(screen.getByRole("radio", { name: /重視するものを選ぶ/ }));
    fireEvent.click(screen.getByRole("radio", { name: "ゆったり" }));
    fireEvent.click(screen.getByRole("button", { name: "グルメ" }));
    fireEvent.click(screen.getByRole("button", { name: "写真映え" }));
    fireEvent.click(screen.getByRole("radio", { name: "歩く距離を少なく" }));
    fireEvent.click(screen.getByRole("button", { name: "経路案を作成" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toMatchObject({
      method: "preferences",
      preferences: { pace: "relaxed", interests: ["photogenic", "gourmet"], priority: "less_walking" },
    });
  });

  it("AIと相談は下書きを残してチャット画面へ進む（compute は呼ばない）", async () => {
    const calls = stubFetch(systemStatus());
    renderWithStatus(<PlanForm list={threeSpots} />, systemStatus());
    fireEvent.click(screen.getByRole("radio", { name: /AIと相談/ }));
    fireEvent.click(screen.getByRole("button", { name: "AIと相談する" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/lists/${LIST_ID}/plan/chat`));
    expect(calls).toHaveLength(0);
    expect(loadPlanDraft(LIST_ID)).toMatchObject({ method: "chat", mode: "transit", spotIds: [S1, S2, S3] });
  });

  it("公共交通・AI が停止中なら該当ボタンだけ無効にして理由を出す（F-8）", () => {
    const status = systemStatus({}, [
      suspendedFeature("route_planning_transit"),
      suspendedFeature("ai_chat"),
    ]);
    stubFetch(status);
    renderWithStatus(<PlanForm list={threeSpots} />, status);
    expect(screen.getByRole("radio", { name: "公共交通＋徒歩" })).toBeDisabled();
    expect(screen.getByText("現在、経路作成（公共交通）は利用できません")).toBeInTheDocument();
    // 使える移動手段に切り替わる
    expect(screen.getByRole("radio", { name: "徒歩のみ" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /AIと相談/ })).toBeDisabled();
    expect(screen.getByText(/現在、AIと相談は利用できません/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /おまかせ/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: "経路案を作成" })).toBeEnabled();
  });

  it("公共交通のキー未設定は無効にせず概算の注記、AI 未設定は「AIと相談」だけ無効", () => {
    const status = systemStatus({ transit: false, ai: false });
    stubFetch(status);
    renderWithStatus(<PlanForm list={threeSpots} />, status);
    expect(screen.getByRole("radio", { name: "公共交通＋徒歩" })).toBeEnabled();
    expect(screen.getByText("公共交通の移動時間は目安（概算）で計算します")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /AIと相談/ })).toBeDisabled();
  });

  it("徒歩・車が停止中なら徒歩・車を無効", () => {
    const status = systemStatus({}, [suspendedFeature("route_planning")]);
    stubFetch(status);
    renderWithStatus(<PlanForm list={threeSpots} />, status);
    expect(screen.getByRole("radio", { name: "徒歩のみ" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "車" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "公共交通＋徒歩" })).toBeEnabled();
  });

  it("拠点が無く出発地が未選択ならエラーを出す", async () => {
    const calls = stubFetch(systemStatus());
    renderWithStatus(<PlanForm list={wishlist(threeSpots.items, false)} />, systemStatus());
    fireEvent.click(screen.getByRole("button", { name: "経路案を作成" }));
    expect(await screen.findByText("出発地を選んでください")).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });
});

// ---------- S-10 ----------

const draft: PlanDraft = {
  spotIds: [S1, S2, S3],
  origin: params.origin,
  destination: null,
  date: "2026-11-03",
  startTime: "09:00",
  endTime: "18:00",
  mode: "transit",
  lunchBreak: true,
  method: "chat",
  preferences: params.preferences,
};

const chatReply: PlanChatResponse = {
  reply: "ひがし茶屋街に夕方着くようにします\u{1F305}",
  conditions: {
    pace: "relaxed",
    interests: ["history"],
    priority: "less_walking",
    timeWindows: [{ spotId: S3, from: "16:00", to: "17:30" }],
    orderHints: [{ spotId: S1, position: "first" }],
    exclude: [],
  },
  unclear: false,
};

function sendMessage(text: string) {
  fireEvent.change(screen.getByLabelText("希望を入力"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "送信" }));
}

describe("PlanChat（S-10）", () => {
  it("返答（絵文字は除去）と読み取った条件を表示し、修正した条件で compute する（F-5-5）", async () => {
    const calls = stubFetch(systemStatus(), (url) =>
      url.endsWith("/plans/chat") ? jsonResponse(chatReply) : jsonResponse(computeResponse),
    );
    renderWithStatus(<PlanChat list={threeSpots} draft={draft} />, systemStatus());
    expect(screen.getByRole("button", { name: "この条件で経路案を作成" })).toBeDisabled();

    sendMessage("夕日は茶屋街で見たい");
    expect(await screen.findByText("ひがし茶屋街に夕方着くようにします")).toBeInTheDocument();
    expect(calls[0].body).toMatchObject({
      listId: LIST_ID,
      spotIds: [S1, S2, S3],
      date: "2026-11-03",
      mode: "transit",
      messages: [{ role: "user", content: "夕日は茶屋街で見たい" }],
    });

    expect(screen.getByRole("radio", { name: "ゆったり" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "歩く距離を少なく" })).toHaveAttribute("aria-checked", "true");
    const windows = screen.getByRole("list", { name: "時刻の指定" });
    expect(windows).toHaveTextContent("ひがし茶屋街 16:00〜17:30");
    expect(screen.getByRole("list", { name: "順番の希望" })).toHaveTextContent("兼六園を最初に");

    // 修正：時刻の指定を削除、ペースを変更、金沢城公園を除外
    fireEvent.click(within(windows).getByRole("button", { name: "ひがし茶屋街の時刻の指定を削除" }));
    expect(screen.queryByRole("list", { name: "時刻の指定" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "ふつう" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "金沢城公園を除外する" }));

    fireEvent.click(screen.getByRole("button", { name: "この条件で経路案を作成" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/lists/${LIST_ID}/plan/result`));
    const compute = calls.find((c) => c.url === "/api/v1/plans/compute");
    expect(compute?.body).toMatchObject({
      method: "chat",
      preferences: {
        pace: "normal",
        priority: "less_walking",
        timeWindows: [],
        orderHints: [{ spotId: S1, position: "first" }],
        exclude: [S2],
      },
    });
    // 会話本文は sessionStorage に残さない
    const stored = Object.values({ ...window.sessionStorage }).join("");
    expect(stored).not.toContain("夕日は茶屋街で見たい");
  });

  it("unclear のときは「選択式で作る」を出し、S-09 の「重視するものを選ぶ」へ戻す", async () => {
    stubFetch(systemStatus(), () =>
      jsonResponse({
        ...chatReply,
        reply: "うまく読み取れませんでした。もう少し具体的に教えてください",
        unclear: true,
      }),
    );
    renderWithStatus(<PlanChat list={threeSpots} draft={draft} />, systemStatus());
    sendMessage("いい感じに");
    const button = await screen.findByRole("button", { name: "選択式で作る" });
    fireEvent.click(button);
    expect(push).toHaveBeenCalledWith(`/lists/${LIST_ID}/plan`);
    expect(loadPlanDraft(LIST_ID)).toMatchObject({ method: "preferences", preferences: { pace: "relaxed" } });
  });

  it(`会話は ${LIMITS.chatMaxTurns} 往復までで、超えたら入力できない`, async () => {
    stubFetch(systemStatus(), () => jsonResponse({ ...chatReply, reply: "わかりました" }));
    renderWithStatus(<PlanChat list={threeSpots} draft={draft} />, systemStatus());
    for (let i = 0; i < LIMITS.chatMaxTurns; i += 1) {
      sendMessage(`希望${i}`);
      await waitFor(() => expect(screen.getAllByText("わかりました")).toHaveLength(i + 1));
    }
    expect(screen.getByText("会話は10往復までです")).toBeInTheDocument();
    expect(screen.getByLabelText("希望を入力")).toBeDisabled();
  });

  it("503（ai_chat 停止中）なら停止中の案内と「選択式で作る」を出し、入力は戻す", async () => {
    stubFetch(systemStatus(), () =>
      jsonResponse(
        { error: { code: "FEATURE_SUSPENDED", message: "停止中", details: { feature: "ai_chat" } } },
        503,
      ),
    );
    renderWithStatus(<PlanChat list={threeSpots} draft={draft} />, systemStatus());
    sendMessage("午前は兼六園");
    expect(await screen.findByText("現在、AIと相談は利用できません")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "選択式で作る" })).toBeInTheDocument();
    expect(screen.getByLabelText("希望を入力")).toHaveValue("午前は兼六園");
    expect(screen.getByLabelText("希望を入力")).toBeDisabled();
  });

  it("429 などのエラーは文言と再試行を出す", async () => {
    stubFetch(systemStatus(), () =>
      jsonResponse({ error: { code: "RATE_LIMITED", message: "操作が多すぎます" } }, 429),
    );
    renderWithStatus(<PlanChat list={threeSpots} draft={draft} />, systemStatus());
    sendMessage("午前は兼六園");
    expect(await screen.findByText("操作が多すぎます")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再試行" })).toBeInTheDocument();
  });
});
