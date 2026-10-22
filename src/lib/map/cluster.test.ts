import { describe, expect, it } from "vitest";
import { CLUSTER_STYLE, MAP_ZOOM, popularityOf } from "@/lib/domain/constants";
import type { SpotSummary } from "@/lib/domain/types";
import {
  buildClusterIndex,
  clusterBounds,
  clusterExpansionZoom,
  clusterItemKey,
  clusterStyleFor,
  getClusters,
  isClusterFeature,
  toClusterView,
} from "./cluster";

function spot(
  id: string,
  lat: number,
  lng: number,
  postCount: number,
  coverThumbUrl: string | null = `/t/${id}.webp`,
): SpotSummary {
  return {
    id,
    name: `スポット${id}`,
    lat,
    lng,
    category: "history",
    postCount,
    likeCount: 0,
    popularity: popularityOf(postCount),
    coverThumbUrl,
    prefecture: "京都府",
    city: "京都市",
  };
}

describe("clusterStyleFor", () => {
  it("投稿数 1〜4 は1枚 48px、5〜19 は2枚 64px、20 以上は3枚 80px", () => {
    expect(clusterStyleFor(0)).toBe(CLUSTER_STYLE[0]);
    expect(clusterStyleFor(4)).toEqual({ maxPosts: 4, layers: 1, size: 48 });
    expect(clusterStyleFor(5)).toEqual({ maxPosts: 19, layers: 2, size: 64 });
    expect(clusterStyleFor(19)).toEqual({ maxPosts: 19, layers: 2, size: 64 });
    expect(clusterStyleFor(20)).toEqual({ maxPosts: Infinity, layers: 3, size: 80 });
    expect(clusterStyleFor(1000).layers).toBe(3);
  });
});

describe("buildClusterIndex", () => {
  const kyoto = { minLng: 135.6, minLat: 34.9, maxLng: 135.9, maxLat: 35.1 };
  // 近接する3点（束になる）と、離れた1点
  const spots = [
    spot("a", 34.9671, 135.7727, 128),
    spot("b", 34.9675, 135.773, 3, null),
    spot("c", 34.968, 135.7735, 10),
    spot("d", 35.0394, 135.7292, 7),
  ];

  it("低ズームでは束になり、投稿数の合計と代表写真（投稿数最大）を持つ", () => {
    const index = buildClusterIndex(spots);
    const items = getClusters(index, kyoto, 9);
    const clusters = items.filter(isClusterFeature);
    expect(clusters.length).toBeGreaterThanOrEqual(1);
    const big = clusters.find((c) => c.properties.point_count === 3);
    expect(big).toBeDefined();
    expect(big!.properties.postCount).toBe(128 + 3 + 10);
    expect(big!.properties.coverThumbUrl).toBe("/t/a.webp");
    expect(big!.properties.coverName).toBe("スポットa");
    const view = toClusterView(big!);
    expect(view.spotCount).toBe(3);
    expect(view.key).toBe(`c:${big!.properties.cluster_id}`);
    expect(clusterItemKey(big!)).toBe(view.key);
  });

  it("写真が無いスポットだけの束でも、写真があるスポットを代表に選ぶ", () => {
    const index = buildClusterIndex([
      spot("x", 35, 135, 50, null),
      spot("y", 35.0001, 135.0001, 2, "/t/y.webp"),
    ]);
    const items = getClusters(index, { minLng: 134, minLat: 34, maxLng: 136, maxLat: 36 }, 9);
    const cluster = items.find(isClusterFeature);
    expect(cluster).toBeDefined();
    expect(cluster!.properties.postCount).toBe(52);
    expect(cluster!.properties.coverThumbUrl).toBe("/t/y.webp");
  });

  it("v0.3 F-1-9：選んだリストのスポットの数を束ごとに数える", () => {
    const index = buildClusterIndex(
      [
        spot("x", 35, 135, 50, null),
        spot("y", 35.0001, 135.0001, 2, "/t/y.webp"),
        spot("z", 35.0002, 135, 1, null),
      ],
      new Set(["x", "z"]),
    );
    const items = getClusters(index, { minLng: 134, minLat: 34, maxLng: 136, maxLat: 36 }, 9);
    const cluster = items.find(isClusterFeature)!;
    expect(toClusterView(cluster).highlightCount).toBe(2);
    const singles = getClusters(index, { minLng: 134, minLat: 34, maxLng: 136, maxLat: 36 }, 20).map(
      toClusterView,
    );
    expect(
      singles
        .filter((v) => v.highlightCount === 1)
        .map((v) => v.key)
        .sort(),
    ).toEqual(["s:x", "s:z"]);
    // 指定しなければ 0
    const plain = buildClusterIndex([spot("x", 35, 135, 50, null)]);
    expect(
      toClusterView(getClusters(plain, { minLng: 134, minLat: 34, maxLng: 136, maxLat: 36 }, 20)[0])
        .highlightCount,
    ).toBe(0);
  });

  it("clusterMax より上のズームでは単独点になる", () => {
    const index = buildClusterIndex(spots);
    const items = getClusters(index, kyoto, MAP_ZOOM.clusterMax + 1);
    expect(items.every((i) => !isClusterFeature(i))).toBe(true);
    const single = toClusterView(items[0]);
    expect(single.spotCount).toBe(1);
    expect(single.clusterId).toBeNull();
    expect(single.key.startsWith("s:")).toBe(true);
  });

  it("clusterBounds は束の全点を囲み、clusterExpansionZoom は pinMin 以下", () => {
    const index = buildClusterIndex(spots);
    const cluster = getClusters(index, kyoto, 9).find(isClusterFeature)!;
    // Supercluster は投影座標から戻すため 1e-6 程度の誤差がある
    const eps = 1e-6;
    const b = clusterBounds(index, cluster.properties.cluster_id);
    expect(b.minLat).toBeLessThanOrEqual(34.9671 + eps);
    expect(b.maxLat).toBeGreaterThanOrEqual(34.968 - eps);
    expect(b.minLng).toBeLessThanOrEqual(135.7727 + eps);
    expect(b.maxLng).toBeGreaterThanOrEqual(135.7735 - eps);
    const z = clusterExpansionZoom(index, cluster.properties.cluster_id);
    expect(z).toBeGreaterThan(9);
    expect(z).toBeLessThanOrEqual(MAP_ZOOM.pinMin);
  });

  it("1,000 件でも index 構築と取得が速い", () => {
    const many: SpotSummary[] = [];
    for (let i = 0; i < 1000; i++) {
      many.push(spot(`s${i}`, 34.9 + (i % 40) * 0.005, 135.6 + Math.floor(i / 40) * 0.01, (i % 30) + 1));
    }
    const start = performance.now();
    const index = buildClusterIndex(many);
    const items = getClusters(index, kyoto, 11);
    expect(performance.now() - start).toBeLessThan(500);
    expect(items.length).toBeGreaterThan(0);
    const total = items.reduce((sum, i) => sum + toClusterView(i).postCount, 0);
    expect(total).toBe(many.reduce((s, m) => s + m.postCount, 0));
  });
});
