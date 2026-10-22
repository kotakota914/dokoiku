import { describe, expect, it } from "vitest";
import { TILE_ZOOMS } from "@/lib/domain/constants";
import { fetchZoomFor, lngLatToTile, tileKey, tileToBbox, tilesForBbox } from "./tiles";
import { bboxContains } from "./view";

/** 金沢駅（鼓門） */
const STATION = { lat: 36.5781, lng: 136.648 };

describe("fetchZoomFor", () => {
  it("表示ズームを 8 / 11 / 14 に丸める（8 以下 → 8、9〜13 → 11、14 以上 → 14）", () => {
    expect(fetchZoomFor(0)).toBe(8);
    expect(fetchZoomFor(8)).toBe(8);
    expect(fetchZoomFor(8.49)).toBe(8);
    expect(fetchZoomFor(8.5)).toBe(11);
    expect(fetchZoomFor(9)).toBe(11);
    expect(fetchZoomFor(13)).toBe(11);
    expect(fetchZoomFor(13.49)).toBe(11);
    expect(fetchZoomFor(13.5)).toBe(14);
    expect(fetchZoomFor(14)).toBe(14);
    expect(fetchZoomFor(19)).toBe(14);
    for (const z of [0, 5, 8, 11, 14, 19]) expect(TILE_ZOOMS).toContain(fetchZoomFor(z));
  });
});

describe("lngLatToTile / tileToBbox", () => {
  it("既知の値：金沢駅は z=14 で x=14411, y=6401（Web メルカトルの標準式）", () => {
    // x = floor((lng + 180) / 360 * 2^z)、y = floor((1 - ln(tan φ + sec φ) / π) / 2 * 2^z)
    expect(lngLatToTile(STATION.lng, STATION.lat, 14)).toEqual({ z: 14, x: 14411, y: 6401 });
    expect(lngLatToTile(STATION.lng, STATION.lat, 11)).toEqual({ z: 11, x: 1801, y: 800 });
    expect(lngLatToTile(STATION.lng, STATION.lat, 8)).toEqual({ z: 8, x: 225, y: 100 });
    expect(tileKey({ z: 14, x: 14411, y: 6401 })).toBe("14/14411/6401");
  });

  it("タイルの bbox はその点を含み、隣のタイルと辺を共有する", () => {
    for (const z of TILE_ZOOMS) {
      const t = lngLatToTile(STATION.lng, STATION.lat, z);
      const b = tileToBbox(t);
      expect(bboxContains(b, STATION)).toBe(true);
      expect(b.minLng).toBeLessThan(b.maxLng);
      expect(b.minLat).toBeLessThan(b.maxLat);
      const right = tileToBbox({ z, x: t.x + 1, y: t.y });
      expect(right.minLng).toBeCloseTo(b.maxLng, 10);
      const below = tileToBbox({ z, x: t.x, y: t.y + 1 });
      expect(below.maxLat).toBeCloseTo(b.minLat, 10);
    }
  });

  it("z=14 のタイル 1 枚は金沢市内で約 2.2km × 1.8km", () => {
    const b = tileToBbox(lngLatToTile(STATION.lng, STATION.lat, 14));
    expect(b.maxLng - b.minLng).toBeCloseTo(360 / 2 ** 14, 10);
    const widthKm = (b.maxLng - b.minLng) * 111.32 * Math.cos((STATION.lat * Math.PI) / 180);
    const heightKm = (b.maxLat - b.minLat) * 111.32;
    expect(widthKm).toBeGreaterThan(1.9);
    expect(widthKm).toBeLessThan(2.1);
    expect(heightKm).toBeGreaterThan(1.9);
    expect(heightKm).toBeLessThan(2.1);
  });

  it("範囲外の緯度・経度は端のタイルに丸める", () => {
    expect(lngLatToTile(-180, 89, 1)).toEqual({ z: 1, x: 0, y: 0 });
    expect(lngLatToTile(180, -89, 1)).toEqual({ z: 1, x: 1, y: 1 });
    expect(lngLatToTile(0, 0, 0)).toEqual({ z: 0, x: 0, y: 0 });
  });
});

describe("tilesForBbox", () => {
  const bbox = (() => {
    // 金沢駅のタイルの中央付近、タイル 1 枚の内側に収まる小さな範囲（駅そのものはタイルの端に近い）
    const b = tileToBbox(lngLatToTile(STATION.lng, STATION.lat, 14));
    const cLng = (b.minLng + b.maxLng) / 2;
    const cLat = (b.minLat + b.maxLat) / 2;
    const dLng = (b.maxLng - b.minLng) * 0.1;
    const dLat = (b.maxLat - b.minLat) * 0.1;
    return { minLng: cLng - dLng, maxLng: cLng + dLng, minLat: cLat - dLat, maxLat: cLat + dLat };
  })();

  it("padding 0 なら範囲を覆うタイルだけ（小さな範囲なら 1 枚）", () => {
    const tiles = tilesForBbox(bbox, 14);
    expect(tiles).toEqual([{ z: 14, x: 14411, y: 6401 }]);
  });

  it("padding 1 で四方に 1 画面分広げると周囲のタイルが加わり、中心に近い順に並ぶ", () => {
    const tiles = tilesForBbox(bbox, 14, 1);
    expect(tiles.length).toBeGreaterThanOrEqual(1);
    expect(tiles[0]).toEqual({ z: 14, x: 14411, y: 6401 });
    const keys = new Set(tiles.map(tileKey));
    expect(keys.size).toBe(tiles.length);
    // 範囲の幅・高さ分だけ外側に広げるので、少なくとも元のタイルを含む
    expect(keys.has("14/14411/6401")).toBe(true);
    // 中心からの距離が単調に増える
    const cx = tiles.reduce((s, t) => s + t.x, 0) / tiles.length;
    const cy = tiles.reduce((s, t) => s + t.y, 0) / tiles.length;
    const dist = tiles.map((t) => (t.x - cx) ** 2 + (t.y - cy) ** 2);
    for (let i = 1; i < dist.length; i++) expect(dist[i]).toBeGreaterThanOrEqual(dist[i - 1] - 1e-9);
  });

  it("広い範囲（金沢市全体を z=14）では複数のタイル、上限 maxTiles で切る", () => {
    const wide = { minLng: 136.55, minLat: 36.48, maxLng: 136.75, maxLat: 36.65 };
    const all = tilesForBbox(wide, 14, 0, 10_000);
    expect(all.length).toBeGreaterThan(50);
    const capped = tilesForBbox(wide, 14, 0, 8);
    expect(capped).toHaveLength(8);
    // 上限で切るときは中心に近いものが残る
    expect(capped).toEqual(all.slice(0, 8));
    // z=8 なら数枚に収まる
    expect(tilesForBbox(wide, 8).length).toBeLessThanOrEqual(4);
  });

  it("日本全体（ズーム 5 相当）を z=8 で覆っても上限で抑えられる", () => {
    const japan = { minLng: 125, minLat: 28, maxLng: 150, maxLat: 46 };
    expect(tilesForBbox(japan, 8, 1).length).toBeLessThanOrEqual(64);
    expect(tilesForBbox(japan, 8, 0, 256).length).toBeLessThanOrEqual(256);
  });
});
