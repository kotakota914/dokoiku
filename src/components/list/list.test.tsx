// @vitest-environment jsdom
/**
 * S-06/S-07 部品の単体テスト（fetch をモック）：
 * - ListPicker：GET /lists → 一覧表示、POST /items の 409（追加済み）で「追加済みです」、
 *   上限の 409 は API の文言、満杯のリストは選べない、成功時は「リストを見る」の導線
 * - ListItemRow：star トグルが PATCH /lists/{id}/items/{spotId} { mustVisit } を呼ぶ
 * - shareUrl：token / url からの共有 URL 組み立て
 * - v0.3 S-07：拠点からの距離・並べ替え・比較の選択制限・合計滞在時間（ListDetail、listItems）
 * - v0.3 S-08：比較表示（CompareView）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { SpotDetail, SpotSummary, Wishlist, WishlistDetail, WishlistItem } from "@/lib/domain/types";
import { formatDistance } from "@/lib/domain/distance";
import { CompareView } from "./CompareView";
import { ListDetail } from "./ListDetail";
import {
  canCompare,
  compareHref,
  formatTopHours,
  parseCompareSpotIds,
  sortListItems,
  stayMinutesOf,
  topHours,
  totalStayMinutes,
} from "./listItems";
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

// ListDetail が使う停止状態と地図（MapLibre は jsdom で動かないので差し替える）
vi.mock("@/components/system/SystemStatusProvider", () => ({
  useSystemStatus: () => ({ loading: false, isSuspended: () => false }),
}));
vi.mock("@/components/map", () => ({ SpotMapLazy: () => null }));

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
  name: "金沢旅行",
  baseLabel: null,
  baseLocation: null,
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
    name: "兼六園",
    lat: 36.5619,
    lng: 136.6625,
    category: "history",
    postCount: 128,
    likeCount: 10,
    popularity: "very_popular",
    coverThumbUrl: null,
    prefecture: "石川県",
    city: "金沢市",
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

    const row = await screen.findByRole("button", { name: /金沢旅行/ });
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
    fireEvent.click(await screen.findByRole("button", { name: /金沢旅行/ }));
    expect(await screen.findByText("金沢旅行に追加しました")).toBeInTheDocument();
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
    fireEvent.click(await screen.findByRole("button", { name: /金沢旅行/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("リストは30か所までです");
    expect(screen.queryByText("追加済みです")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("上限に達したリストは「上限」バッジ付きで選べない", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ ...list, itemCount: LIMITS.itemsPerList }]));
    render(wrap(<ListPicker spotId={item.spotId} open onClose={() => {}} />));
    const row = await screen.findByRole("button", { name: /金沢旅行/ });
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
    expect(screen.getByRole("link", { name: "兼六園" })).toHaveAttribute("href", `/spots/${item.spotId}`);
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
    expect(screen.queryByRole("button", { name: /兼六園をリストから削除/ })).toBeNull();
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

// ---------- v0.3 S-07 / S-08 ----------

const STATION = { lat: 36.578, lng: 136.6478 };

function spotOf(n: number, over: Partial<SpotSummary>): SpotSummary {
  const id = `33333333-3333-4333-8333-${String(n).padStart(12, "0")}`;
  return {
    id,
    name: `スポット${n}`,
    lat: 36.56,
    lng: 136.66,
    category: "other",
    postCount: 0,
    likeCount: 0,
    popularity: "normal",
    coverThumbUrl: null,
    prefecture: "石川県",
    city: "金沢市",
    ...over,
  };
}

function itemOf(spot: SpotSummary | null, n: number, spotId?: string): WishlistItem {
  return {
    spotId: spot?.id ?? spotId ?? `44444444-4444-4444-8444-${String(n).padStart(12, "0")}`,
    mustVisit: false,
    createdAt: `2026-10-01T10:0${n}:00.000+09:00`,
    spot,
  };
}

// 追加順：兼六園（歴史・約2.2km）→ 近江町市場（グルメ・約290m 相当）→ 卯辰山（自然・遠い）→ 削除済み
const kenroku = spotOf(1, {
  name: "兼六園",
  lat: 36.5619,
  lng: 136.6625,
  category: "history",
  popularity: "popular",
  likeCount: 5,
  postCount: 8,
});
const market = spotOf(2, {
  name: "近江町市場",
  lat: 36.58,
  lng: 136.65,
  category: "gourmet",
  popularity: "very_popular",
  likeCount: 3,
  postCount: 30,
});
const utatsu = spotOf(3, {
  name: "卯辰山",
  lat: 36.58,
  lng: 136.69,
  category: "nature",
  popularity: "popular",
  likeCount: 5,
  postCount: 9,
});
const detailItems: WishlistItem[] = [
  itemOf(kenroku, 1),
  itemOf(market, 2),
  itemOf(utatsu, 3),
  itemOf(null, 4),
];

function detailOf(over: Partial<WishlistDetail> = {}): WishlistDetail {
  return { ...list, itemCount: detailItems.length, items: detailItems, plans: [], ...over };
}

function spotNames(): string[] {
  const rows = within(screen.getByRole("list", { name: "リスト内のスポット" })).getAllByRole("listitem");
  return rows.map((r) => r.querySelector("a.font-semibold, p.font-semibold")?.textContent ?? "");
}

describe("listItems（端末内の計算）", () => {
  it("距離は 1km 未満なら m、以上なら小数 1 桁の km", () => {
    expect(formatDistance(349)).toBe("約350m");
    expect(formatDistance(0)).toBe("約0m");
    expect(formatDistance(994)).toBe("約990m");
    expect(formatDistance(996)).toBe("約1.0km");
    expect(formatDistance(2345)).toBe("約2.3km");
  });

  it("並べ替え：距離順・人気順（popularity → likeCount → postCount）・カテゴリ別。削除済みは末尾", () => {
    const names = (items: WishlistItem[]) => items.map((i) => i.spot?.name ?? "削除済み");
    expect(names(sortListItems(detailItems, "added", STATION))).toEqual([
      "兼六園",
      "近江町市場",
      "卯辰山",
      "削除済み",
    ]);
    expect(names(sortListItems(detailItems, "distance", STATION))).toEqual([
      "近江町市場",
      "兼六園",
      "卯辰山",
      "削除済み",
    ]);
    // 拠点が無ければ追加順のまま
    expect(names(sortListItems(detailItems, "distance", null))).toEqual(names(detailItems));
    // 大人気が先、同じ「人気」はいいね同数なので投稿数の多い卯辰山が先
    expect(names(sortListItems(detailItems, "popular", null))).toEqual([
      "近江町市場",
      "卯辰山",
      "兼六園",
      "削除済み",
    ]);
    // CATEGORIES の順（自然 → グルメ → 歴史・文化）
    expect(names(sortListItems(detailItems, "category", null))).toEqual([
      "卯辰山",
      "近江町市場",
      "兼六園",
      "削除済み",
    ]);
    // 元の配列は変えない
    expect(names(detailItems)).toEqual(["兼六園", "近江町市場", "卯辰山", "削除済み"]);
  });

  it("滞在時間は投稿 3 件以上の中央値、なければカテゴリの標準値。合計は削除済みを除く", () => {
    expect(stayMinutesOf({ category: "history", postCount: 5, stayMinutesMedian: 90 })).toEqual({
      minutes: 90,
      source: "median",
    });
    expect(stayMinutesOf({ category: "history", postCount: 2, stayMinutesMedian: 90 })).toEqual({
      minutes: 45,
      source: "default",
    });
    // 歴史 45 + グルメ 60 + 自然 60
    expect(totalStayMinutes(detailItems)).toBe(165);
  });

  it("投稿が多い時間帯は上位 2 つ、投稿 5 件未満なら「—」", () => {
    const h = Array.from({ length: 24 }, (_, i) => (i === 14 ? 4 : i === 10 ? 2 : i === 9 ? 2 : 0));
    expect(topHours(h)).toEqual([14, 9]);
    expect(formatTopHours(topHours(h))).toBe("14時台・9時台");
    expect(topHours([1, 1, 1, 1])).toEqual([]);
    expect(formatTopHours([])).toBe("—");
  });

  it("比較は 2〜3 件だけ。クエリはリスト内の UUID だけを重複なく拾う", () => {
    expect([0, 1, 2, 3, 4].map(canCompare)).toEqual([false, false, true, true, false]);
    expect(compareHref(list.id, [kenroku.id, market.id])).toBe(
      `/lists/${list.id}/compare?spots=${encodeURIComponent(`${kenroku.id},${market.id}`)}`,
    );
    const allowed = [kenroku.id, market.id, utatsu.id];
    expect(parseCompareSpotIds(`${market.id}, ${kenroku.id},${market.id},x,${item.spotId}`, allowed)).toEqual(
      [market.id, kenroku.id],
    );
    expect(parseCompareSpotIds("", allowed)).toEqual([]);
  });
});

describe("ListDetail（S-07 v0.3）", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("拠点が未設定なら案内と「拠点を設定」を出し、距離は出さず、距離順は選べない", () => {
    render(wrap(<ListDetail list={detailOf()} currentUserId="user-1" />));
    expect(screen.getAllByText("拠点を設定すると距離が表示されます")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "拠点を設定" })).toBeInTheDocument();
    expect(screen.queryByTestId("item-distance")).toBeNull();
    const select = screen.getByRole("combobox", { name: "並べ替え" });
    const distance = within(select).getByRole("option", { name: /距離順/ }) as HTMLOptionElement;
    expect(distance.disabled).toBe(true);
    expect(distance.textContent).toContain("拠点を設定すると選べます");
    // 削除済みスポットの表示は維持
    expect(screen.getByText("このスポットは削除されました")).toBeInTheDocument();
  });

  it("拠点があれば各スポットに距離を出し、距離順・人気順・カテゴリ別に並べ替えられる", () => {
    render(
      wrap(
        <ListDetail list={detailOf({ baseLabel: "金沢駅", baseLocation: STATION })} currentUserId="user-1" />,
      ),
    );
    expect(screen.getByTestId("list-base-label")).toHaveTextContent("金沢駅");
    expect(screen.getByRole("button", { name: "変更" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "解除" })).toBeInTheDocument();
    const distances = screen.getAllByTestId("item-distance").map((el) => el.textContent);
    // 削除済み以外の 3 件
    expect(distances).toHaveLength(3);
    expect(distances[0]).toMatch(/^金沢駅から 約2\.\dkm$/);
    expect(distances[1]).toMatch(/^金沢駅から 約\d+0m$/);

    expect(spotNames()).toEqual(["兼六園", "近江町市場", "卯辰山", "削除されたスポット"]);
    const select = screen.getByRole("combobox", { name: "並べ替え" });
    fireEvent.change(select, { target: { value: "distance" } });
    expect(spotNames()).toEqual(["近江町市場", "兼六園", "卯辰山", "削除されたスポット"]);
    fireEvent.change(select, { target: { value: "popular" } });
    expect(spotNames()).toEqual(["近江町市場", "卯辰山", "兼六園", "削除されたスポット"]);
    fireEvent.change(select, { target: { value: "category" } });
    expect(spotNames()).toEqual(["卯辰山", "近江町市場", "兼六園", "削除されたスポット"]);
    // 並べ替えで API は呼ばない
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("合計滞在時間の目安を「合計 約○時間＋移動」で出す", () => {
    render(wrap(<ListDetail list={detailOf()} currentUserId="user-1" />));
    expect(screen.getByTestId("list-total-stay")).toHaveTextContent("合計 約2時間45分＋移動");
  });

  it("比較は 2〜3 件のときだけ押せる。削除済みは選べない", () => {
    render(wrap(<ListDetail list={detailOf()} currentUserId="user-1" />));
    fireEvent.click(screen.getByRole("button", { name: "比較する" }));
    expect(screen.getByText("2〜3件選んでください")).toBeInTheDocument();
    const region = screen.getByRole("region", { name: "比較の選択" });
    const compareDisabled = () => within(region).getByRole("button", { name: "比較" });

    expect(compareDisabled()).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "兼六園を比較に選ぶ" }));
    expect(compareDisabled()).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "近江町市場を比較に選ぶ" }));
    const link = within(region).getByRole("link", { name: "比較" });
    expect(link).toHaveAttribute("href", compareHref(list.id, [kenroku.id, market.id]));
    fireEvent.click(screen.getByRole("checkbox", { name: "卯辰山を比較に選ぶ" }));
    expect(within(region).getByRole("link", { name: "比較" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "削除されたスポットを比較に選ぶ" })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "兼六園を比較に選ぶ" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "近江町市場を比較に選ぶ" }));
    expect(compareDisabled()).toBeDisabled();
    expect(within(region).getByText("1件選択中")).toBeInTheDocument();

    fireEvent.click(within(region).getByRole("button", { name: "やめる" }));
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("4 件選ぶと比較は押せない", () => {
    const fourth = spotOf(5, { name: "金沢港" });
    const items = [...detailItems.slice(0, 3), itemOf(fourth, 5)];
    render(wrap(<ListDetail list={detailOf({ items, itemCount: 4 })} currentUserId="user-1" />));
    fireEvent.click(screen.getByRole("button", { name: "比較する" }));
    for (const name of ["兼六園", "近江町市場", "卯辰山", "金沢港"])
      fireEvent.click(screen.getByRole("checkbox", { name: `${name}を比較に選ぶ` }));
    const region = screen.getByRole("region", { name: "比較の選択" });
    expect(within(region).getByText("4件選択中")).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "比較" })).toBeDisabled();
    expect(within(region).queryByRole("link", { name: "比較" })).toBeNull();
  });

  it("拠点の解除は PATCH /lists/{id} { base: null } を呼び、距離が消える", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...list, baseLabel: null, baseLocation: null }));
    render(
      wrap(
        <ListDetail list={detailOf({ baseLabel: "金沢駅", baseLocation: STATION })} currentUserId="user-1" />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "解除" }));
    const confirm = screen.getByRole("dialog", { name: "拠点を解除しますか" });
    fireEvent.click(within(confirm).getByRole("button", { name: "解除" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1/lists/${list.id}`);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ base: null });
    await waitFor(() => expect(screen.queryByTestId("item-distance")).toBeNull());
    expect(screen.getByRole("button", { name: "拠点を設定" })).toBeInTheDocument();
  });

  it("拠点の設定：現在地を選ぶと PATCH /lists/{id} { base } を呼ぶ（場所検索以外の外部 API は呼ばない）", async () => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (ok: PositionCallback) =>
          ok({
            coords: { latitude: STATION.lat, longitude: STATION.lng, accuracy: 10 },
          } as GeolocationPosition),
      },
    });
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...list, baseLabel: "現在地", baseLocation: STATION }));
    render(wrap(<ListDetail list={detailOf()} currentUserId="user-1" />));
    fireEvent.click(screen.getByRole("button", { name: "拠点を設定" }));
    const dialog = screen.getByRole("dialog", { name: "拠点を設定" });
    fireEvent.click(within(dialog).getByRole("button", { name: "現在地を取得" }));
    const submit = within(dialog).getByRole("button", { name: "設定" });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ base: { label: "現在地", location: STATION } });
    expect(await screen.findByTestId("list-base-label")).toHaveTextContent("現在地");
    expect(screen.getAllByTestId("item-distance")).toHaveLength(3);
  });
});

describe("CompareView（S-08）", () => {
  function detailSpot(s: SpotSummary, over: Partial<SpotDetail> = {}): SpotDetail {
    return {
      ...s,
      address: null,
      stayMinutesMedian: null,
      hourHistogram: Array.from({ length: 24 }, () => 0),
      openingHours: null,
      coverFullUrl: null,
      createdAt: "2026-10-01T10:00:00.000+09:00",
      ...over,
    };
  }

  it("2〜3 件を横並びで比較し、拠点からの距離・時間帯・滞在時間を出す", () => {
    const hist = Array.from({ length: 24 }, (_, h) => (h === 10 ? 6 : h === 15 ? 3 : 0));
    render(
      <CompareView
        list={{ id: list.id, name: "金沢旅行", baseLabel: "金沢駅", baseLocation: STATION }}
        columns={[
          { spotId: kenroku.id, spot: detailSpot(kenroku, { stayMinutesMedian: 90, hourHistogram: hist }) },
          { spotId: market.id, spot: detailSpot(market) },
          { spotId: utatsu.id, spot: null },
        ]}
      />,
    );
    const table = screen.getByRole("table", { name: "スポットの比較" });
    expect(within(table).getAllByRole("columnheader")).toHaveLength(4);
    expect(within(table).getByText("兼六園")).toBeInTheDocument();
    expect(within(table).getByText("このスポットは削除されました")).toBeInTheDocument();
    const row = (name: string | RegExp) => within(table).getByRole("row", { name });
    expect(row(/いいね合計/)).toHaveTextContent("5件");
    expect(row(/平均的な滞在時間/)).toHaveTextContent("約1時間30分");
    expect(row(/平均的な滞在時間/)).toHaveTextContent("約1時間");
    expect(row(/投稿が多い時間帯/)).toHaveTextContent("10時台・15時台");
    expect(row(/投稿が多い時間帯/)).toHaveTextContent("—");
    expect(row(/金沢駅からの距離/)).toHaveTextContent(/約2\.\dkm/);
    expect(row(/人気度/)).toHaveTextContent("大人気");
    expect(screen.getAllByRole("link", { name: /リストへ戻る/ })[0]).toHaveAttribute(
      "href",
      `/lists/${list.id}`,
    );
  });

  it("1 件以下・4 件以上なら「2〜3件選んでください」とリストへ戻る導線", () => {
    render(
      <CompareView
        list={{ id: list.id, name: "金沢旅行", baseLabel: null, baseLocation: null }}
        columns={[{ spotId: kenroku.id, spot: null }]}
      />,
    );
    expect(screen.getByText("2〜3件選んでください")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("link", { name: /リストへ戻る/ })).toHaveAttribute("href", `/lists/${list.id}`);
  });
});
