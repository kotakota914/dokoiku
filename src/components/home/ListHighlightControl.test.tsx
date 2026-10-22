// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Wishlist, WishlistDetail } from "@/lib/domain/types";
import { ListHighlightButton, ListHighlightStatus } from "./ListHighlightControl";
import { toListHighlight } from "./listHighlight";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const list: Wishlist = {
  id: "list-1",
  userId: "u1",
  name: "金沢旅行",
  baseLabel: "金沢駅",
  baseLocation: { lat: 36.578, lng: 136.648 },
  shareToken: null,
  createdAt: "2026-10-22T09:00:00+09:00",
  itemCount: 1,
};
const detail: WishlistDetail = {
  ...list,
  items: [
    {
      spotId: "s1",
      mustVisit: false,
      createdAt: "2026-10-22T09:00:00+09:00",
      spot: {
        id: "s1",
        name: "兼六園",
        lat: 36.5619,
        lng: 136.6625,
        category: "history",
        postCount: 3,
        likeCount: 0,
        popularity: "normal",
        coverThumbUrl: null,
        prefecture: null,
        city: null,
      },
    },
  ],
  plans: [],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ListHighlightButton（F-1-9）", () => {
  it("開くと GET /lists、選ぶと GET /lists/{id} を取得して onSelect に渡す", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/v1/lists")) return jsonResponse({ lists: [list] });
      if (url.endsWith("/api/v1/lists/list-1")) return jsonResponse(detail);
      return jsonResponse({ error: { code: "NOT_FOUND", message: "x" } }, 404);
    });
    const onSelect = vi.fn();
    render(<ListHighlightButton active={null} onSelect={onSelect} onClear={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "リストを地図に表示" }));
    const row = await screen.findByRole("button", { name: /金沢旅行/ });
    expect(row).toHaveTextContent("1か所");
    expect(row).toHaveTextContent("金沢駅");
    fireEvent.click(row);
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    const h = onSelect.mock.calls[0][0];
    expect(h.listId).toBe("list-1");
    expect([...h.spotIds]).toEqual(["s1"]);
    expect(h.base).toEqual({ lat: 36.578, lng: 136.648, label: "金沢駅" });
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual(["/api/v1/lists", "/api/v1/lists/list-1"]);
  });

  it("リストが無ければ空の案内、取得失敗は再試行ボタン", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ lists: [] }));
    render(<ListHighlightButton active={null} onSelect={() => {}} onClear={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "リストを地図に表示" }));
    expect(await screen.findByText("リストがまだありません")).toBeInTheDocument();
    cleanup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error: { code: "INTERNAL_ERROR", message: "サーバーでエラーが発生しました" } }, 500),
    );
    render(<ListHighlightButton active={null} onSelect={() => {}} onClear={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "リストを地図に表示" }));
    expect(await screen.findByText("サーバーでエラーが発生しました")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /再読み込み|再試行/ })).toBeInTheDocument();
  });
});

describe("ListHighlightStatus", () => {
  it("表示中のリストと拠点を出し、「表示を解除」で onClear", () => {
    const onClear = vi.fn();
    render(<ListHighlightStatus highlight={toListHighlight(detail)} onClear={onClear} />);
    const status = screen.getByRole("status", { name: "表示中のリスト" });
    expect(status).toHaveTextContent("「金沢旅行」を表示中（1か所）");
    expect(status).toHaveTextContent("拠点：金沢駅");
    fireEvent.click(screen.getByRole("button", { name: "リストの表示を解除" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
