import { describe, expect, it, vi } from "vitest";
import type { Category } from "@/lib/domain/constants";
import type { HeatPoint, SpotSummary } from "@/lib/domain/types";
import {
  MAX_PREFETCH_TILES,
  MAX_VISIBLE_TILES,
  TileLoader,
  cacheKey,
  categoriesKey,
  mergeVisible,
  planTiles,
  pruneCache,
  throttle,
  tileRequestPath,
  type TileData,
  type TileViewState,
} from "./tileCache";
import { lngLatToTile, tileKey, tileToBbox, type TileCoord } from "./tiles";

const STATION = { lat: 36.5781, lng: 136.648 };

function spot(id: string, lat: number, lng: number, postCount = 1): SpotSummary {
  return {
    id,
    name: id,
    lat,
    lng,
    category: "other",
    postCount,
    likeCount: 0,
    popularity: "normal",
    coverThumbUrl: null,
    prefecture: null,
    city: null,
  };
}

/** タイルの内側の点 */
function pointIn(tile: TileCoord, fx = 0.5, fy = 0.5) {
  const b = tileToBbox(tile);
  return { lat: b.minLat + (b.maxLat - b.minLat) * fy, lng: b.minLng + (b.maxLng - b.minLng) * fx };
}

/** 金沢駅のタイルの中央付近、タイル 1 枚に収まる小さな表示範囲 */
function smallBbox(z: number) {
  const t = lngLatToTile(STATION.lng, STATION.lat, z);
  const b = tileToBbox(t);
  const c = pointIn(t);
  const dLng = (b.maxLng - b.minLng) * 0.05;
  const dLat = (b.maxLat - b.minLat) * 0.05;
  return {
    tile: t,
    bbox: { minLng: c.lng - dLng, maxLng: c.lng + dLng, minLat: c.lat - dLat, maxLat: c.lat + dLat },
  };
}

describe("categoriesKey / cacheKey / tileRequestPath", () => {
  it("カテゴリは順序・重複に依らず同じキーになり、キャッシュのキーに含まれる", () => {
    expect(categoriesKey([])).toBe("");
    expect(categoriesKey(["nature", "gourmet"])).toBe("gourmet,nature");
    expect(categoriesKey(["gourmet", "nature", "gourmet"])).toBe("gourmet,nature");
    const t = { z: 14, x: 14411, y: 6401 };
    expect(cacheKey("", t)).toBe("|14/14411/6401");
    expect(cacheKey("gourmet,nature", t)).toBe("gourmet,nature|14/14411/6401");
    expect(cacheKey("gourmet", t)).not.toBe(cacheKey("", t));
  });

  it("リクエストのパスは /spots/tiles/{z}/{x}/{y}、絞り込みがあれば category を付ける", () => {
    const t = { z: 14, x: 14411, y: 6401 };
    expect(tileRequestPath(t, [])).toBe("/spots/tiles/14/14411/6401");
    expect(tileRequestPath(t, ["nature", "gourmet"])).toBe(
      "/spots/tiles/14/14411/6401?category=gourmet%2Cnature",
    );
  });
});

describe("planTiles", () => {
  it("表示ズームを 8/11/14 に丸め、表示用の区画と先読み（外側 1 画面分）の区画を列挙する", () => {
    const { tile, bbox } = smallBbox(14);
    const plan = planTiles({ bbox, zoom: 15.3, categories: [], has: () => false });
    expect(plan.z).toBe(14);
    expect(plan.catKey).toBe("");
    expect(plan.visible[0]).toEqual(tile);
    // 先読みの区画は表示用の区画の後に続き、重複しない
    expect(plan.missing.length).toBeGreaterThanOrEqual(plan.visible.length);
    expect(plan.missing.slice(0, plan.visible.length)).toEqual(plan.visible);
    expect(new Set(plan.missing.map(tileKey)).size).toBe(plan.missing.length);
    expect(plan.missing.every((t) => t.z === 14)).toBe(true);
  });

  it("取得済み・取得中の区画は missing から除く（同じ場所に戻っても再取得しない）", () => {
    const { tile, bbox } = smallBbox(11);
    const done = new Set([cacheKey("", tile)]);
    const plan = planTiles({ bbox, zoom: 12, categories: [], has: (k) => done.has(k) });
    expect(plan.z).toBe(11);
    expect(plan.visible.map(tileKey)).toContain(tileKey(tile));
    expect(plan.missing.map(tileKey)).not.toContain(tileKey(tile));
    const all = planTiles({ bbox, zoom: 12, categories: [], has: () => true });
    expect(all.missing).toEqual([]);
    expect(all.visible.length).toBeGreaterThan(0);
  });

  it("絞り込みが変わると別のキーになるので取り直す", () => {
    const { tile, bbox } = smallBbox(14);
    const done = new Set([cacheKey("", tile)]);
    const plan = planTiles({ bbox, zoom: 14, categories: ["gourmet"], has: (k) => done.has(k) });
    expect(plan.catKey).toBe("gourmet");
    expect(plan.missing.map(tileKey)).toContain(tileKey(tile));
  });

  it("広い範囲でも上限で抑える", () => {
    const japan = { minLng: 125, minLat: 28, maxLng: 150, maxLat: 46 };
    const plan = planTiles({ bbox: japan, zoom: 5, categories: [], has: () => false });
    expect(plan.z).toBe(8);
    expect(plan.visible.length).toBeLessThanOrEqual(MAX_VISIBLE_TILES);
    expect(plan.missing.length).toBeLessThanOrEqual(MAX_VISIBLE_TILES + MAX_PREFETCH_TILES);
  });
});

describe("mergeVisible", () => {
  const z = 14;
  const a: TileCoord = { z, x: 14411, y: 6401 };
  const b: TileCoord = { z, x: 14412, y: 6401 };
  const pa = pointIn(a);
  const pb = pointIn(b);

  it("表示範囲の区画のスポットを結合し、id で重複を除く", () => {
    const shared = spot("shared", pa.lat, pa.lng, 5);
    const cache = new Map<string, TileData>([
      [cacheKey("", a), { mode: "spots", spots: [spot("a1", pa.lat, pa.lng), shared] }],
      [cacheKey("", b), { mode: "spots", spots: [shared, spot("b1", pb.lat, pb.lng)] }],
    ]);
    const res = mergeVisible({ z, catKey: "", visible: [a, b] }, (k) => cache.get(k));
    expect(res.mode).toBe("spots");
    expect(res.spots.map((s) => s.id)).toEqual(["a1", "shared", "b1"]);
    expect(res.points).toEqual([]);
    expect(res).toMatchObject({ loaded: 2, total: 2, complete: true });
  });

  it("未取得の区画がある間は、その区画に入る前回のピンを残す（取得済みの区画のものは残さない）", () => {
    const cache = new Map<string, TileData>([
      [cacheKey("", a), { mode: "spots", spots: [spot("a1", pa.lat, pa.lng)] }],
    ]);
    const carry = {
      spots: [
        spot("old-in-b", pb.lat, pb.lng), // b は未取得 → 残す
        spot("old-in-a", pa.lat, pa.lng), // a は取得済みで含まれていない → 消す
        spot("far", 35, 135), // 表示範囲外 → 消す
      ],
      points: [] as HeatPoint[],
    };
    const res = mergeVisible({ z, catKey: "", visible: [a, b] }, (k) => cache.get(k), carry);
    expect(res.complete).toBe(false);
    expect(res.spots.map((s) => s.id)).toEqual(["a1", "old-in-b"]);
  });

  it("z=8 はヒートマップの点を座標で重複排除して返す", () => {
    const h: TileCoord = { z: 8, x: 225, y: 100 };
    const p = pointIn(h);
    const cache = new Map<string, TileData>([
      [
        cacheKey("", h),
        {
          mode: "heatmap",
          points: [
            { ...p, weight: 3 },
            { ...p, weight: 3 },
            { lat: p.lat + 0.01, lng: p.lng, weight: 1 },
          ],
        },
      ],
    ]);
    const res = mergeVisible({ z: 8, catKey: "", visible: [h] }, (k) => cache.get(k));
    expect(res.mode).toBe("heatmap");
    expect(res.points).toHaveLength(2);
    expect(res.spots).toEqual([]);
    expect(res.complete).toBe(true);
  });

  it("何も取得していなければ空で complete: false", () => {
    const res = mergeVisible({ z, catKey: "", visible: [a] }, () => undefined);
    expect(res).toMatchObject({ spots: [], points: [], loaded: 0, total: 1, complete: false });
  });
});

describe("pruneCache", () => {
  it("上限を超えた分を古い順に捨てる", () => {
    const cache = new Map<string, number>();
    for (let i = 0; i < 10; i++) cache.set(`k${i}`, i);
    expect(pruneCache(cache, 8)).toBe(2);
    expect([...cache.keys()]).toEqual(["k2", "k3", "k4", "k5", "k6", "k7", "k8", "k9"]);
    expect(pruneCache(cache, 8)).toBe(0);
  });
});

describe("TileLoader", () => {
  type Pending = {
    tile: TileCoord;
    categories: readonly Category[];
    signal: AbortSignal;
    resolve: (d: TileData) => void;
    reject: (e: unknown) => void;
  };

  function setup(maxConcurrent = 6) {
    const pending: Pending[] = [];
    const states: TileViewState[] = [];
    const fetchTile = vi.fn(
      (tile: TileCoord, categories: readonly Category[], signal: AbortSignal) =>
        new Promise<TileData>((resolve, reject) => {
          pending.push({ tile, categories, signal, resolve, reject });
        }),
    );
    const loader = new TileLoader({ fetchTile, onChange: (s) => states.push(s), maxConcurrent });
    return { loader, pending, states, fetchTile };
  }

  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("表示範囲の区画を同時 maxConcurrent 件まで取得し、届いた分から画面に出す", async () => {
    const { loader, pending, states, fetchTile } = setup(2);
    const { tile } = smallBbox(14);
    // タイルの 6 割ほどの表示範囲：外側 1 画面分の先読みで隣のタイルも対象になる
    const b = tileToBbox(tile);
    const c = pointIn(tile);
    const dLng = (b.maxLng - b.minLng) * 0.3;
    const dLat = (b.maxLat - b.minLat) * 0.3;
    const bbox = { minLng: c.lng - dLng, maxLng: c.lng + dLng, minLat: c.lat - dLat, maxLat: c.lat + dLat };
    loader.setViewport(bbox, 14);
    expect(fetchTile).toHaveBeenCalledTimes(2);
    expect(loader.inflightCount).toBe(2);
    expect(pending[0].tile).toEqual(tile);
    // 最初の通知は未取得（complete: false、ピンなし）
    expect(states.at(-1)).toMatchObject({ mode: "spots", spots: [], complete: false, z: 14 });

    const p = pointIn(tile);
    pending[0].resolve({ mode: "spots", spots: [spot("s1", p.lat, p.lng)] });
    await flush();
    expect(states.at(-1)?.spots.map((s) => s.id)).toEqual(["s1"]);
    expect(states.at(-1)?.complete).toBe(true);
    // 1 件終わったので次の区画（先読み）を取りに行く
    expect(loader.inflightCount).toBe(2);
    expect(fetchTile).toHaveBeenCalledTimes(3);
  });

  it("同じ場所に戻っても取得済みの区画は再取得しない", async () => {
    const { loader, pending, fetchTile } = setup(1);
    const { tile, bbox } = smallBbox(14);
    loader.setViewport(bbox, 14);
    pending[0].resolve({ mode: "spots", spots: [] });
    await flush();
    const calls = fetchTile.mock.calls.length;
    loader.setViewport(bbox, 14);
    expect(loader.hasTile("", tile)).toBe(true);
    // 表示用の区画は取得済み。先読みの残りだけが続く（同じ区画は呼ばれない）
    const requestedAgain = fetchTile.mock.calls.slice(calls).some((c) => tileKey(c[0]) === tileKey(tile));
    expect(requestedAgain).toBe(false);
  });

  it("ズーム段階が変わると古い取得を中断し、新しい段階の区画を取りに行く", async () => {
    const { loader, pending, fetchTile } = setup(1);
    const { bbox } = smallBbox(14);
    loader.setViewport(bbox, 14);
    const first = pending[0];
    expect(first.tile.z).toBe(14);
    loader.setViewport(bbox, 10);
    expect(first.signal.aborted).toBe(true);
    expect(fetchTile).toHaveBeenCalledTimes(2);
    expect(pending[1].tile.z).toBe(11);
    // 中断した取得が後から失敗しても inflight に残らない
    first.reject(new DOMException("aborted", "AbortError"));
    await flush();
    expect(loader.inflightCount).toBe(1);
  });

  it("失敗した区画は取得済みに入れず、次の移動で再取得する。エラーは状態に出さない", async () => {
    const { loader, pending, states, fetchTile } = setup(1);
    const { tile, bbox } = smallBbox(14);
    loader.setViewport(bbox, 14);
    pending[0].reject(new Error("network"));
    await flush();
    expect(loader.hasTile("", tile)).toBe(false);
    expect(states.every((s) => !("error" in s))).toBe(true);
    // 次の移動（同じ範囲）で同じ区画を取り直す。失敗後は先読みの続きが走るので、その後の呼び出しを見る
    const before = fetchTile.mock.calls.length;
    loader.setViewport({ ...bbox, minLng: bbox.minLng + 1e-6 }, 14);
    const again = fetchTile.mock.calls.slice(before - 1).some((c) => tileKey(c[0]) === tileKey(tile));
    expect(again || pending.some((p) => tileKey(p.tile) === tileKey(tile) && !p.signal.aborted)).toBe(true);
  });

  it("絞り込みを変えるとキャッシュを分け、前のピンは引き継がない", async () => {
    const { loader, pending, states } = setup(1);
    const { tile, bbox } = smallBbox(14);
    loader.setViewport(bbox, 14);
    const p = pointIn(tile);
    pending[0].resolve({ mode: "spots", spots: [spot("all", p.lat, p.lng)] });
    await flush();
    expect(states.at(-1)?.spots).toHaveLength(1);
    loader.setCategories(["gourmet"]);
    expect(states.at(-1)?.spots).toEqual([]);
    expect(states.at(-1)?.complete).toBe(false);
    const req = pending.find((x) => x.categories.includes("gourmet") && !x.signal.aborted);
    expect(req).toBeDefined();
    req!.resolve({ mode: "spots", spots: [] });
    await flush();
    expect(states.at(-1)).toMatchObject({ spots: [], complete: true });
    // 絞り込みを戻すと取得済みのデータをすぐ使う
    loader.setCategories([]);
    expect(states.at(-1)?.spots.map((s) => s.id)).toEqual(["all"]);
    expect(states.at(-1)?.complete).toBe(true);
  });

  it("dispose で取得中をすべて中断し、以後は通知しない", async () => {
    const { loader, pending, states } = setup(2);
    const { bbox } = smallBbox(14);
    loader.setViewport(bbox, 14);
    const n = states.length;
    loader.dispose();
    expect(pending.every((p) => p.signal.aborted)).toBe(true);
    expect(loader.inflightCount).toBe(0);
    pending[0].resolve({ mode: "spots", spots: [] });
    await flush();
    expect(states.length).toBe(n);
  });
});

describe("TileLoader（loading と retry）", () => {
  it("取得が終わると loading: false。失敗した区画は retry で取り直す", async () => {
    const calls: { tile: TileCoord; resolve: (d: TileData) => void; reject: (e: unknown) => void }[] = [];
    const states: TileViewState[] = [];
    const loader = new TileLoader({
      fetchTile: (tile) =>
        new Promise<TileData>((resolve, reject) => {
          calls.push({ tile, resolve, reject });
        }),
      onChange: (st) => states.push(st),
      maxConcurrent: 100,
    });
    const { tile, bbox } = smallBbox(14);
    loader.setViewport(bbox, 14);
    expect(states.at(-1)?.loading).toBe(true);
    for (const c of calls) c.reject(new Error("offline"));
    await new Promise((r) => setTimeout(r, 0));
    expect(states.at(-1)).toMatchObject({ loading: false, complete: false });
    const n = calls.length;
    loader.retry();
    expect(calls.slice(n).some((c) => tileKey(c.tile) === tileKey(tile))).toBe(true);
    loader.dispose();
  });
});

describe("throttle", () => {
  it("先頭ですぐ呼び、間隔内の呼び出しは最後の 1 回だけを間隔後に呼ぶ。flush で即実行", () => {
    vi.useFakeTimers();
    try {
      let t = 0;
      const fn = vi.fn();
      const th = throttle(fn, 300, () => t);
      th(1);
      expect(fn).toHaveBeenLastCalledWith(1);
      t = 100;
      th(2);
      t = 200;
      th(3);
      expect(fn).toHaveBeenCalledTimes(1);
      t = 300;
      vi.advanceTimersByTime(200);
      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn).toHaveBeenLastCalledWith(3);
      t = 350;
      th(4);
      th.flush();
      expect(fn).toHaveBeenCalledTimes(3);
      expect(fn).toHaveBeenLastCalledWith(4);
      t = 400;
      th(5);
      th.cancel();
      vi.advanceTimersByTime(1000);
      expect(fn).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
