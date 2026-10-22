import { describe, expect, it } from "vitest";
import type { SpotSummary, WishlistDetail } from "@/lib/domain/types";
import { highlightFitPoints, highlightSummary, toListHighlight, withHighlightedSpots } from "./listHighlight";

function spot(id: string, category: SpotSummary["category"] = "history"): SpotSummary {
  return {
    id,
    name: id,
    lat: 36.56,
    lng: 136.66,
    category,
    postCount: 3,
    likeCount: 0,
    popularity: "normal",
    coverThumbUrl: null,
    prefecture: "石川県",
    city: "金沢市",
  };
}

function detail(over: Partial<WishlistDetail> = {}): WishlistDetail {
  return {
    id: "list-1",
    userId: "u1",
    name: "金沢旅行",
    baseLabel: "金沢駅",
    baseLocation: { lat: 36.578, lng: 136.648 },
    shareToken: null,
    createdAt: "2026-10-22T09:00:00+09:00",
    itemCount: 3,
    items: [
      { spotId: "a", mustVisit: false, createdAt: "2026-10-22T09:00:00+09:00", spot: spot("a") },
      { spotId: "b", mustVisit: true, createdAt: "2026-10-22T09:00:00+09:00", spot: spot("b", "gourmet") },
      { spotId: "gone", mustVisit: false, createdAt: "2026-10-22T09:00:00+09:00", spot: null },
    ],
    plans: [],
    ...over,
  };
}

describe("toListHighlight（F-1-9）", () => {
  it("削除されたスポットを除いて強調対象にし、拠点を house マーカー用に取り出す", () => {
    const h = toListHighlight(detail());
    expect(h.listId).toBe("list-1");
    expect([...h.spotIds]).toEqual(["a", "b"]);
    expect(h.spots.map((s) => s.id)).toEqual(["a", "b"]);
    expect(h.base).toEqual({ lat: 36.578, lng: 136.648, label: "金沢駅" });
    expect(highlightSummary(h)).toBe("「金沢旅行」を表示中（2か所）");
  });

  it("拠点が null なら base も null（拠点のマーカーを出さない）", () => {
    const h = toListHighlight(detail({ baseLabel: null, baseLocation: null }));
    expect(h.base).toBeNull();
    expect(highlightFitPoints(h)).toHaveLength(2);
  });

  it("拠点の名前が無くても座標があれば表示する", () => {
    expect(toListHighlight(detail({ baseLabel: null })).base).toEqual({
      lat: 36.578,
      lng: 136.648,
      label: "",
    });
  });

  it("地図を合わせる範囲はスポットと拠点", () => {
    const pts = highlightFitPoints(toListHighlight(detail()));
    expect(pts).toEqual([
      { lat: 36.56, lng: 136.66 },
      { lat: 36.56, lng: 136.66 },
      { lat: 36.578, lng: 136.648 },
    ]);
  });
});

describe("withHighlightedSpots", () => {
  const h = toListHighlight(detail());

  it("未取得のリストのスポットを足し、取得済みのものは重ねない", () => {
    const loaded = [spot("a"), spot("x")];
    expect(withHighlightedSpots(loaded, h, []).map((s) => s.id)).toEqual(["a", "x", "b"]);
  });

  it("カテゴリで絞り込み中ならそのカテゴリのものだけを足す", () => {
    expect(withHighlightedSpots([], h, ["gourmet"]).map((s) => s.id)).toEqual(["b"]);
    expect(withHighlightedSpots([], h, ["nature"])).toEqual([]);
  });

  it("リスト未選択・足すものが無いときは同じ配列を返す（無駄な再計算をしない）", () => {
    const loaded = [spot("a"), spot("b", "gourmet")];
    expect(withHighlightedSpots(loaded, null, [])).toBe(loaded);
    expect(withHighlightedSpots(loaded, h, [])).toBe(loaded);
  });
});
