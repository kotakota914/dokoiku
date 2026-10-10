import { describe, expect, it, vi } from "vitest";
import type { ApiUsage, SuspendedFeature, TravelTimeEntry } from "@/lib/domain/types";
import type { ApiUsageRepo, TravelCacheRepo } from "@/lib/repo/types";
import { coordKey, spotKey } from "@/lib/utils/geo";
import { getRouteGeometry, getTravelMatrix, travelMatrixIdOf, type TravelPoint } from "./travel";

/** TravelCacheRepo だけを満たす偽物 */
function fakeTravelCache(initial: Omit<TravelTimeEntry, "fetchedAt">[] = []) {
  const store = new Map<string, TravelTimeEntry>();
  for (const e of initial)
    store.set(`${e.mode}:${e.fromKey}|${e.toKey}`, { ...e, fetchedAt: "2026-10-10T00:00:00.000+09:00" });
  const repo: TravelCacheRepo & { store: Map<string, TravelTimeEntry>; getManyCalls: number } = {
    store,
    getManyCalls: 0,
    getMany: async (pairs, mode) => {
      repo.getManyCalls += 1;
      const out = new Map<string, TravelTimeEntry>();
      for (const p of pairs) {
        const e = store.get(`${mode}:${p.fromKey}|${p.toKey}`);
        if (e) out.set(`${p.fromKey}|${p.toKey}`, e);
      }
      return out;
    },
    putMany: async (entries) => {
      for (const e of entries)
        store.set(`${e.mode}:${e.fromKey}|${e.toKey}`, { ...e, fetchedAt: "2026-10-10T00:00:00.000+09:00" });
    },
    purgeExpired: async () => 0,
  };
  return repo;
}

/** ApiUsageRepo だけを満たす偽物（回数だけ数える） */
function fakeUsage() {
  const rows = new Map<string, ApiUsage>();
  const k = (p: string, f: string, period: string) => `${p}/${f}/${period}`;
  const repo: ApiUsageRepo & { rows: Map<string, ApiUsage> } = {
    rows,
    get: async (p, f, period) => rows.get(k(p, f, period)) ?? null,
    increment: async (p, f, period, limit, by = 1) => {
      const row = rows.get(k(p, f, period)) ?? {
        provider: p,
        feature: f,
        period,
        count: 0,
        limit,
        suspendedAt: null,
      };
      row.count += by;
      rows.set(k(p, f, period), row);
      return { ...row };
    },
    set: async (p, f, period, count, limit) => {
      const row = {
        provider: p,
        feature: f,
        period,
        count,
        limit,
        suspendedAt: rows.get(k(p, f, period))?.suspendedAt ?? null,
      };
      rows.set(k(p, f, period), row);
      return { ...row };
    },
    setSuspended: async (p, f, period, at) => {
      const row = rows.get(k(p, f, period));
      if (row) row.suspendedAt = at;
    },
    listSuspended: async (): Promise<SuspendedFeature[]> => [],
  };
  return repo;
}

const ORIGIN: TravelPoint = { key: coordKey({ lat: 34.9858, lng: 135.7588 }), lat: 34.9858, lng: 135.7588 };
const A: TravelPoint = { key: spotKey("a"), lat: 34.9948, lng: 135.785 };
const B: TravelPoint = { key: spotKey("b"), lat: 35.0037, lng: 135.7788 };

function fullCacheEntries(points: TravelPoint[], mode: "walking" | "driving") {
  const out: Omit<TravelTimeEntry, "fetchedAt">[] = [];
  for (const a of points)
    for (const b of points)
      if (a.key !== b.key) out.push({ fromKey: a.key, toKey: b.key, mode, durationSec: 600, distanceM: 800 });
  return out;
}

describe("travelMatrixIdOf", () => {
  it("キーの順に依らず同じ ID、mode が違えば別の ID", () => {
    const id1 = travelMatrixIdOf([ORIGIN.key, A.key, B.key], "walking");
    const id2 = travelMatrixIdOf([B.key, ORIGIN.key, A.key], "walking");
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^tm_walking_[0-9a-f]{16}$/);
    expect(travelMatrixIdOf([ORIGIN.key, A.key, B.key], "driving")).not.toBe(id1);
  });
});

describe("getTravelMatrix", () => {
  it("キャッシュ全ヒットなら外部を呼ばず、回数も数えない", async () => {
    const cache = fakeTravelCache(fullCacheEntries([ORIGIN, A, B], "walking"));
    const usage = fakeUsage();
    const fetchMatrix = vi.fn();
    const r = await getTravelMatrix({ travelCache: cache, apiUsage: usage }, [ORIGIN, A, B], "walking", {
      fetchMatrix,
      routingEnabled: true,
    });
    expect(fetchMatrix).not.toHaveBeenCalled();
    expect(usage.rows.size).toBe(0);
    expect(r.estimated).toBe(false);
    expect(r.matrix.size).toBe(6);
    expect(r.matrix.get(`${ORIGIN.key}|${A.key}`)).toEqual({ durationSec: 600, distanceM: 800 });
  });

  it("1 件でも欠けていれば ORS を 1 回だけ呼んで全ペアを保存する", async () => {
    const partial = fullCacheEntries([ORIGIN, A, B], "walking").slice(0, 5);
    const cache = fakeTravelCache(partial);
    const usage = fakeUsage();
    const fetchMatrix = vi.fn(async (points: readonly { lat: number; lng: number }[]) => {
      const n = points.length;
      const durations = Array.from({ length: n }, (_, i) =>
        Array.from({ length: n }, (_, j) => (i === j ? 0 : 100 * (i + 1) + j)),
      );
      const distances = Array.from({ length: n }, (_, i) =>
        Array.from({ length: n }, (_, j) => (i === j ? 0 : 1000 * (i + 1) + j)),
      );
      return { durations, distances };
    });
    const r = await getTravelMatrix({ travelCache: cache, apiUsage: usage }, [ORIGIN, A, B], "walking", {
      fetchMatrix,
      routingEnabled: true,
    });
    expect(fetchMatrix).toHaveBeenCalledTimes(1);
    expect(r.estimated).toBe(false);
    expect(r.matrix.size).toBe(6);
    expect(r.matrix.get(`${ORIGIN.key}|${B.key}`)).toEqual({ durationSec: 102, distanceM: 1002 });
    expect(cache.store.size).toBe(6);
    const row = [...usage.rows.values()][0];
    expect(row).toMatchObject({ provider: "ors", feature: "route_planning", count: 1 });

    // 2 回目は全ヒットなので呼ばない（F-5-6 の再計算）
    const r2 = await getTravelMatrix({ travelCache: cache, apiUsage: usage }, [ORIGIN, A, B], "walking", {
      fetchMatrix,
      routingEnabled: true,
    });
    expect(fetchMatrix).toHaveBeenCalledTimes(1);
    expect(r2.travelMatrixId).toBe(r.travelMatrixId);
  });

  it("到達不能（null）のペアは行列にもキャッシュにも入れない", async () => {
    const cache = fakeTravelCache();
    const usage = fakeUsage();
    const fetchMatrix = vi.fn(async () => ({
      durations: [
        [0, 100, null],
        [100, 0, null],
        [null, null, 0],
      ],
      distances: [
        [0, 1000, null],
        [1000, 0, null],
        [null, null, 0],
      ],
    }));
    const r = await getTravelMatrix({ travelCache: cache, apiUsage: usage }, [ORIGIN, A, B], "walking", {
      fetchMatrix,
      routingEnabled: true,
    });
    expect(r.matrix.size).toBe(2);
    expect(r.matrix.has(`${ORIGIN.key}|${B.key}`)).toBe(false);
    expect(cache.store.size).toBe(2);
  });

  it("ORS 未設定なら直線距離で概算し（estimated=true）、キャッシュに入れず回数も数えない", async () => {
    const cache = fakeTravelCache();
    const usage = fakeUsage();
    const fetchMatrix = vi.fn();
    const r = await getTravelMatrix({ travelCache: cache, apiUsage: usage }, [ORIGIN, A, B], "walking", {
      fetchMatrix,
      routingEnabled: false,
    });
    expect(fetchMatrix).not.toHaveBeenCalled();
    expect(r.estimated).toBe(true);
    expect(r.matrix.size).toBe(6);
    const leg = r.matrix.get(`${ORIGIN.key}|${A.key}`)!;
    // 直線 約2.6km × 1.3 ≈ 3.4km、徒歩 4.5km/h ≈ 45 分
    expect(leg.distanceM).toBeGreaterThan(3000);
    expect(leg.distanceM).toBeLessThan(4000);
    expect(leg.durationSec).toBeGreaterThan(2400);
    expect(leg.durationSec).toBeLessThan(3200);
    expect(cache.store.size).toBe(0);
    expect(usage.rows.size).toBe(0);
  });

  it("停止中なら FEATURE_SUSPENDED で外部を呼ばない", async () => {
    const cache = fakeTravelCache();
    const usage = fakeUsage();
    const now = new Date("2026-10-10T03:00:00Z");
    await usage.set("ors", "route_planning", "2026-10-10", 400, 500);
    await usage.setSuspended("ors", "route_planning", "2026-10-10", "2026-10-10T10:00:00.000+09:00");
    const fetchMatrix = vi.fn();
    await expect(
      getTravelMatrix({ travelCache: cache, apiUsage: usage }, [ORIGIN, A], "walking", {
        fetchMatrix,
        routingEnabled: true,
        now,
      }),
    ).rejects.toMatchObject({ code: "FEATURE_SUSPENDED" });
    expect(fetchMatrix).not.toHaveBeenCalled();
  });

  it("同じ座標の出発地・到着地は 1 地点にまとめる", async () => {
    const cache = fakeTravelCache(fullCacheEntries([ORIGIN, A], "driving"));
    const usage = fakeUsage();
    const r = await getTravelMatrix(
      { travelCache: cache, apiUsage: usage },
      [ORIGIN, A, { ...ORIGIN }],
      "driving",
      { routingEnabled: true },
    );
    expect(r.matrix.size).toBe(2);
  });
});

describe("getRouteGeometry", () => {
  it("ORS があれば 1 回呼んで LineString を返す", async () => {
    const usage = fakeUsage();
    const fetchDirections = vi.fn(
      async () =>
        [
          [135.7588, 34.9858],
          [135.77, 34.99],
          [135.785, 34.9948],
        ] as [number, number][],
    );
    const r = await getRouteGeometry(
      { travelCache: fakeTravelCache(), apiUsage: usage },
      [ORIGIN, A],
      "walking",
      { fetchDirections, routingEnabled: true },
    );
    expect(fetchDirections).toHaveBeenCalledTimes(1);
    expect(r.estimated).toBe(false);
    expect(r.geometry.coordinates).toHaveLength(3);
    expect([...usage.rows.values()][0]).toMatchObject({ provider: "ors", count: 1 });
  });

  it("ORS が無ければ直線（estimated=true）", async () => {
    const r = await getRouteGeometry(
      { travelCache: fakeTravelCache(), apiUsage: fakeUsage() },
      [ORIGIN, A, B],
      "walking",
      { routingEnabled: false },
    );
    expect(r.estimated).toBe(true);
    expect(r.geometry).toEqual({
      type: "LineString",
      coordinates: [
        [ORIGIN.lng, ORIGIN.lat],
        [A.lng, A.lat],
        [B.lng, B.lat],
      ],
    });
  });

  it("上流エラーなら直線で代替する", async () => {
    const fetchDirections = vi.fn(async () => {
      throw new Error("boom");
    });
    const r = await getRouteGeometry(
      { travelCache: fakeTravelCache(), apiUsage: fakeUsage() },
      [ORIGIN, A],
      "walking",
      { fetchDirections, routingEnabled: true },
    );
    expect(r.estimated).toBe(true);
    expect(r.geometry.coordinates).toHaveLength(2);
  });
});
