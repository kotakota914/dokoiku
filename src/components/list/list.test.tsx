// @vitest-environment jsdom
/**
 * S-06/S-07 部品の単体テスト（fetch をモック）：
 * - ListPicker：GET /lists → 一覧表示、POST /items の 409（追加済み）で「追加済みです」、
 *   上限の 409 は API の文言、満杯のリストは選べない、成功時は「リストを見る」の導線
 * - ListItemRow：star トグルが PATCH /lists/{id}/items/{spotId} { mustVisit } を呼ぶ
 * - shareUrl：token / url からの共有 URL 組み立て
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Wishlist, WishlistItem } from "@/lib/domain/types";
import { ToastProvider } from "@/components/ui/Toast";
import { ListItemRow } from "./ListItemRow";
import { LIMITS } from "@/lib/domain/constants";
import { ListPicker, isAlreadyAddedError, normalizeLists } from "./ListPicker";
import { ApiClientError } from "@/lib/api/client";
import { buildShareUrl, shareTokenOf } from "./shareUrl";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// BottomSheet が使う matchMedia（jsdom には無い）
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  push.mockReset();
});

function wrap(ui: ReactNode) {
  return <ToastProvider>{ui}</ToastProvider>;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const list: Wishlist = {
  id: "11111111-1111-4111-8111-111111111111",
  userId: "user-1",
  name: "京都旅行",
  shareToken: null,
  createdAt: "2026-10-01T10:00:00.000+09:00",
  itemCount: 3,
};

const item: WishlistItem = {
  spotId: "22222222-2222-4222-8222-222222222222",
  mustVisit: false,
  createdAt: "2026-10-01T10:00:00.000+09:00",
  spot: {
    id: "22222222-2222-4222-8222-222222222222",
    name: "伏見稲荷大社",
    lat: 34.9671,
    lng: 135.7727,
    category: "history",
    postCount: 128,
    likeCount: 10,
    popularity: "very_popular",
    coverThumbUrl: null,
    prefecture: "京都府",
    city: "京都市",
  },
};

describe("ListPicker", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("開くと GET /api/v1/lists を呼び、409 なら「追加済みです」を出す", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([list]))
      .mockResolvedValueOnce(jsonResponse({ error: { code: "CONFLICT", message: "追加済みです" } }, 409));
    const onClose = vi.fn();
    const onAdded = vi.fn();
    render(wrap(<ListPicker spotId={item.spotId} open onClose={onClose} onAdded={onAdded} />));

    const row = await screen.findByRole("button", { name: /京都旅行/ });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/lists");
    expect(row.textContent).toContain("3/30");

    fireEvent.click(row);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe(`/api/v1/lists/${list.id}/items`);
    const init = fetchMock.mock.calls[1][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ spotId: item.spotId });

    expect(await screen.findByText("追加済みです")).toBeInTheDocument();
    expect(onAdded).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("追加に成功したら「<リスト名>に追加しました」と「リストを見る」の導線を出し onAdded を呼ぶ", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([list]))
      .mockResolvedValueOnce(jsonResponse({ spotId: item.spotId, mustVisit: false }, 201));
    const onAdded = vi.fn();
    render(wrap(<ListPicker spotId={item.spotId} open onClose={() => {}} onAdded={onAdded} />));
    fireEvent.click(await screen.findByRole("button", { name: /京都旅行/ }));
    expect(await screen.findByText("京都旅行に追加しました")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /リストを見る/ })).toHaveAttribute("href", `/lists/${list.id}`);
    expect(onAdded).toHaveBeenCalledWith(list);
  });

  it("上限超過の 409 は「追加済みです」ではなく API の文言をエラーとして出す（F-4-2）", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([{ ...list, itemCount: 29 }]))
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: "CONFLICT", message: "リストは30か所までです" } }, 409),
      );
    const onClose = vi.fn();
    render(wrap(<ListPicker spotId={item.spotId} open onClose={onClose} />));
    fireEvent.click(await screen.findByRole("button", { name: /京都旅行/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("リストは30か所までです");
    expect(screen.queryByText("追加済みです")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("上限に達したリストは「上限」バッジ付きで選べない", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ ...list, itemCount: LIMITS.itemsPerList }]));
    render(wrap(<ListPicker spotId={item.spotId} open onClose={() => {}} />));
    const row = await screen.findByRole("button", { name: /京都旅行/ });
    expect(row).toBeDisabled();
    expect(row).toHaveTextContent("上限");
    expect(row).toHaveTextContent("30/30");
    expect(screen.getByText(/リストは30か所までです/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("isAlreadyAddedError は文言が「追加済みです」の CONFLICT だけ true", () => {
    expect(isAlreadyAddedError(new ApiClientError(409, { code: "CONFLICT", message: "追加済みです" }))).toBe(
      true,
    );
    expect(
      isAlreadyAddedError(new ApiClientError(409, { code: "CONFLICT", message: "リストは30か所までです" })),
    ).toBe(false);
    expect(isAlreadyAddedError(new Error("追加済みです"))).toBe(false);
  });

  it("未ログイン（401）ならログイン画面へ移動する", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: "UNAUTHORIZED", message: "ログインが必要です" } }, 401),
    );
    render(wrap(<ListPicker spotId={item.spotId} open onClose={() => {}} />));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(String(push.mock.calls[0][0])).toMatch(/^\/login/);
  });

  it("リストが無ければ空状態と作成ボタンを出す", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    render(wrap(<ListPicker spotId={item.spotId} open onClose={() => {}} />));
    expect(await screen.findByText("まだリストがありません")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新しいリストを作る" })).toBeInTheDocument();
  });

  it("normalizeLists は配列と { items } の両方を受ける", () => {
    expect(normalizeLists([list])).toEqual([list]);
    expect(normalizeLists({ items: [list] })).toEqual([list]);
    expect(normalizeLists(null)).toEqual([]);
  });
});

describe("ListItemRow", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("star を押すと PATCH /lists/{id}/items/{spotId} { mustVisit: true } を呼ぶ", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...item, mustVisit: true }));
    const onChange = vi.fn();
    render(
      wrap(
        <ul>
          <ListItemRow listId={list.id} item={item} onMustVisitChange={onChange} />
        </ul>,
      ),
    );
    const star = screen.getByRole("button", { name: "必ず行きたい" });
    expect(star).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(star);
    expect(star).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1/lists/${list.id}/items/${item.spotId}`);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ mustVisit: true });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(item.spotId, true));
    expect(screen.getByRole("link", { name: "伏見稲荷大社" })).toHaveAttribute(
      "href",
      `/spots/${item.spotId}`,
    );
  });

  it("API が失敗したら元に戻す", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: "INTERNAL_ERROR", message: "失敗" } }, 500),
    );
    render(
      wrap(
        <ul>
          <ListItemRow listId={list.id} item={item} />
        </ul>,
      ),
    );
    const star = screen.getByRole("button", { name: "必ず行きたい" });
    fireEvent.click(star);
    await waitFor(() => expect(star).toHaveAttribute("aria-pressed", "false"));
  });

  it("削除済みスポットはバッジを出し、star を出さない。readOnly なら操作ボタンを出さない", () => {
    render(
      wrap(
        <ul>
          <ListItemRow listId={list.id} item={{ ...item, spot: null }} />
          <ListItemRow listId={list.id} item={item} readOnly />
        </ul>,
      ),
    );
    expect(screen.getByText("このスポットは削除されました")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "必ず行きたい" })).toBeNull();
    expect(screen.getByRole("button", { name: /削除されたスポットをリストから削除/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /伏見稲荷大社をリストから削除/ })).toBeNull();
  });
});

describe("shareUrl", () => {
  it("origin と token から /shared/{token} を組み立てる", () => {
    expect(buildShareUrl("https://example.com", "abc")).toBe("https://example.com/shared/abc");
    expect(buildShareUrl("https://example.com/", "a b")).toBe("https://example.com/shared/a%20b");
  });
  it("shareToken → token → url の順に token を取り出す", () => {
    expect(shareTokenOf({ shareToken: "t1", url: "https://x/shared/t2" })).toBe("t1");
    expect(shareTokenOf({ token: "t3" })).toBe("t3");
    expect(shareTokenOf({ url: "https://x/shared/t4?x=1" })).toBe("t4");
    expect(shareTokenOf(null)).toBeNull();
  });
});
