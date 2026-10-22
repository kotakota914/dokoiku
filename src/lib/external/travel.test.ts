import { describe, expect, it, vi } from "vitest";
import { USAGE_LIMITS } from "@/lib/domain/constants";
import type { ApiUsage, SuspendedFeature, TravelTimeEntry } from "@/lib/domain/types";
import type { ApiUsageRepo, TravelCacheRepo } from "@/lib/repo/types";
import { coordKey, spotKey } from "@/lib/utils/geo";
import type { RouteMatrixElement } from "./google-routes";
import {
  getLegsOffline,
  getTravelMatrix,
  timeBucketFor,
  transitElementCount,
  travelMatrixIdOf,
  type TravelPoint,
  type TravelQuery,
} from "./travel";

type Entry = Omit<TravelTimeEntry, "fetchedAt">;

/** TravelCacheRepo だけを満たす偽物（mode と timeBucket で分ける） */
function fakeTravelCache(initial: Entry[] = []) {
  const store = new Map<string, TravelTimeEntry>();
  const k = (mode: string, bucket: string, from: string, to: string) => `${mode}:${bucket}:${from}|${to}`;
  for (const e of initial)
    store.set(k(e.mode, e.timeBucket, e.fromKey, e.toKey), {
      ...e,
      fetchedAt: "2026-10-10T00:00:00.000+09:00",
    });
  const repo: TravelCacheRepo & { store: Map<string, TravelTimeEntry> } = {
    store,
    getMany: async (pairs, mode, timeBucket = "any") => {
      const out = new Map<string, TravelTimeEntry>();
      for (const p of pairs) {
        const e = store.get(k(mode, timeBucket, p.fromKey, p.toKey));
        if (e) out.set(`${p.fromKey}|${p.toKey}`, e);
      }
      return out;
    },
    putMany: async (entries) => {
      for (const e of entries)
        store.set(k(e.mode, e.timeBucket, e.fromKey, e.toKey), {
          ...e,
          fetchedAt: "2026-10-10T00:00:00.000+09:00",
        });
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

const ORIGIN: TravelPoint = { key: coordKey({ lat: 36.578, lng: 136.6478 }), lat: 36.578, lng: 136.6478 };
const A: TravelPoint = { key: spotKey("a"), lat: 36.5621, lng: 136.6625 };
const B: TravelPoint = { key: spotKey("b"), lat: 36.5725, lng: 136.6666 };
/** 2026-11-04 は水曜 */
const WALK: TravelQuery = { mode: "walking", date: "2026-11-04", startTime: "09:00" };
const DRIVE: TravelQuery = { ...WALK, mode: "driving" };
const TRANSIT: TravelQuery = { ...WALK, mode: "transit" };
const NO_MOCK = { mock: false } as const;

function fullCacheEntries(points: TravelPoint[], mode: Entry["mode"], timeBucket = "any"): Entry[] {
  const out: Entry[] = [];
  for (const a of points)
    for (const b of points)
      if (a.key !== b.key)
        out.push({ fromKey: a.key, toKey: b.key, mode, timeBucket, durationSec: 600, distanceM: 800 });
  return out;
}

/** origins × destinations の全要素を ROUTE_EXISTS で返す偽の Google Routes */
function routesOk(durationOf = (i: number, j: number) => 300 + i * 10 + j) {
  return vi.fn(async (origins: readonly unknown[], destinations: readonly unknown[]) => {
    const out: RouteMatrixElement[] = [];
    origins.forEach((_, i) =>
      destinations.forEach((__, j) =>
        out.push({
          originIndex: i,
          destinationIndex: j,
          durationSec: durationOf(i, j),
          distanceM: 2000,
          condition: "ROUTE_EXISTS",
        }),
      ),
    );
    return out;
  });
}

describe("timeBucketFor / travelMatrixIdOf", () => {
  it("公共交通は 平日|休日-出発時、徒歩・車は any", () => {
    expect(timeBucketFor(TRANSIT)).toBe("weekday-09");
    expect(timeBucketFor({ ...TRANSIT, date: "2026-11-07", startTime: "14:30" })).toBe("holiday-14");
    expect(timeBucketFor({ ...TRANSIT, date: "2026-11-08" })).toBe("holiday-09");
    expect(timeBucketFor(WALK)).toBe("any");
    expect(timeBucketFor({ ...DRIVE, date: "2026-11-07" })).toBe("any");
  });
  it("キーの順に依らず同じ ID、mode・区分が違えば別の ID", () => {
    const id1 = travelMatrixIdOf([ORIGIN.key, A.key, B.key], "walking");
    expect(travelMatrixIdOf([B.key, ORIGIN.key, A.key], "walking")).toBe(id1);
    expect(id1).toMatch(/^tm_walking_[0-9a-f]{16}$/);
    expect(travelMatrixIdOf([ORIGIN.key, A.key], "transit", "weekday-09")).not.toBe(
      travelMatrixIdOf([ORIGIN.key, A.key], "transit", "holiday-09"),
    );
  });
});

describe("getTravelMatrix（徒歩・車：ORS）", () => {
  it("キャッシュ全ヒットなら外部を呼ばず、回数も数えない", async () => {
    const cache = fakeTravelCache(fullCacheEntries([ORIGIN, A, B], "walking"));
    const usage = fakeUsage();
    const fetchMatrix = vi.fn();
    const r = await getTravelMatrix({ travelCache: cache, apiUsage: usage }, [ORIGIN, A, B], WALK, {
      ...NO_MOCK,
      fetchMatrix,
      routingEnabled: true,
    });
    expect(fetchMatrix).not.toHaveBeenCalled();
    expect(r.externalCalls).toBe(0);
    expect(usage.rows.size).toBe(0);
    expect(r.matrix.size).toBe(6);
    expect(r.matrix.get(`${ORIGIN.key}|${A.key}`)).toEqual({
      durationSec: 600,
      distanceM: 800,
      estimated: false,
      mode: "walking",
      walkM: 800,
    });
  });

  it("1 件でも欠けていれば ORS を 1 回だけ呼んで全ペアを保存し、2 回目は呼ばない", async () => {
    const cache = fakeTravelCache(fullCacheEntries([ORIGIN, A, B], "driving").slice(0, 5));
    const usage = fakeUsage();
    const fetchMatrix = vi.fn(async (points: readonly unknown[]) => {
      const n = points.length;
      const grid = (base: number) =>
        Array.from({ length: n }, (_, i) =>
          Array.from({ length: n }, (__, j) => (i === j ? 0 : base * (i + 1) + j)),
        );
      return { durations: grid(100), distances: grid(1000) };
    });
    const deps = { ...NO_MOCK, fetchMatrix, routingEnabled: true };
    const r = await getTravelMatrix({ travelCache: cache, apiUsage: usage }, [ORIGIN, A, B], DRIVE, deps);
    expect(fetchMatrix).toHaveBeenCalledTimes(1);
    expect(r.externalCalls).toBe(1);
    expect(r.estimated).toBe(false);
    expect(r.matrix.get(`${ORIGIN.key}|${B.key}`)).toMatchObject({
      durationSec: 102,
      distanceM: 1002,
      walkM: 0,
    });
    expect(cache.store.size).toBe(6);
    expect([...cache.store.values()].every((e) => e.timeBucket === "any")).toBe(true);
    expect([...usage.rows.values()][0]).toMatchObject({
      provider: "ors",
      feature: "route_planning",
      count: 1,
    });

    await getTravelMatrix({ travelCache: cache, apiUsage: usage }, [ORIGIN, A, B], DRIVE, deps);
    expect(fetchMatrix).toHaveBeenCalledTimes(1);
  });

  it("到達不能（null）のペアは行列にもキャッシュにも入れない", async () => {
    const cache = fakeTravelCache();
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
    const r = await getTravelMatrix({ travelCache: cache, apiUsage: fakeUsage() }, [ORIGIN, A, B], WALK, {
      ...NO_MOCK,
      fetchMatrix,
      routingEnabled: true,
    });
    expect(r.matrix.size).toBe(2);
    expect(r.matrix.has(`${ORIGIN.key}|${B.key}`)).toBe(false);
    expect(cache.store.size).toBe(2);
  });

  it("ORS 未設定・上流エラーなら直線距離で概算（estimated）。停止中は 503 で呼ばない", async () => {
    const cache = fakeTravelCache();
    const usage = fakeUsage();
    const none = await getTravelMatrix({ travelCache: cache, apiUsage: usage }, [ORIGIN, A, B], WALK, {
      ...NO_MOCK,
      routingEnabled: false,
    });
    expect(none.estimated).toBe(true);
    expect(none.matrix.get(`${ORIGIN.key}|${A.key}`)).toMatchObject({ estimated: true, mode: "walking" });
    expect(usage.rows.size).toBe(0);

    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = vi.fn(async () => {
      throw new Error("boom");
    });
    const err = await getTravelMatrix({ travelCache: cache, apiUsage: usage }, [ORIGIN, A], DRIVE, {
      ...NO_MOCK,
      fetchMatrix: failing,
      routingEnabled: true,
    });
    expect(err.estimated).toBe(true);
    expect(err.matrix.size).toBe(2);

    const now = new Date("2026-10-10T03:00:00Z");
    await usage.set("ors", "route_planning", "2026-10-10", 400, 500);
    await usage.setSuspended("ors", "route_planning", "2026-10-10", "2026-10-10T10:00:00.000+09:00");
    const fetchMatrix = vi.fn();
    await expect(
      getTravelMatrix({ travelCache: cache, apiUsage: usage }, [ORIGIN, B], WALK, {
        ...NO_MOCK,
        fetchMatrix,
        routingEnabled: true,
        now,
      }),
    ).rejects.toMatchObject({ code: "FEATURE_SUSPENDED" });
    expect(fetchMatrix).not.toHaveBeenCalled();
  });

  it("同じ座標の出発地・到着地は 1 地点にまとめる", async () => {
    const cache = fakeTravelCache(fullCacheEntries([ORIGIN, A], "driving"));
    const r = await getTravelMatrix(
      { travelCache: cache, apiUsage: fakeUsage() },
      [ORIGIN, A, { ...ORIGIN }],
      DRIVE,
      {
        ...NO_MOCK,
        routingEnabled: true,
      },
    );
    expect(r.matrix.size).toBe(2);
  });
});

describe("getTravelMatrix（公共交通：Google Routes）", () => {
  it("キャッシュに無い組み合わせだけを 1 回で取得し、件数で数え、区分付きで保存する", async () => {
    // ORIGIN→A と A→ORIGIN はキャッシュ済み（weekday-09）
    const cached = fullCacheEntries([ORIGIN, A], "transit", "weekday-09");
    const cache = fakeTravelCache(cached);
    const usage = fakeUsage();
    const compute = routesOk();
    const r = await getTravelMatrix({ travelCache: cache, apiUsage: usage }, [ORIGIN, A, B], TRANSIT, {
      ...NO_MOCK,
      computeRouteMatrix: compute,
      transitEnabled: true,
    });
    expect(compute).toHaveBeenCalledTimes(1);
    const [origins, destinations, departure] = compute.mock.calls[0] as unknown as [
      TravelPoint[],
      TravelPoint[],
      string,
    ];
    // 欠けているのは ORIGIN→B, A→B, B→ORIGIN, B→A
    expect(origins.map((p) => p.key)).toEqual([ORIGIN.key, A.key, B.key]);
    expect(destinations.map((p) => p.key)).toEqual([B.key, ORIGIN.key, A.key]);
    expect(departure).toBe("2026-11-04T09:00:00+09:00");
    const count = transitElementCount(origins, destinations);
    expect(count).toBe(3 * 3 - 3);
    const { provider, feature } = USAGE_LIMITS.google_routes_transit;
    const rows = [...usage.rows.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider, feature, count });
    expect(r.externalCalls).toBe(1);
    expect(r.estimated).toBe(false);
    expect(r.matrix.size).toBe(6);
    expect(r.matrix.get(`${A.key}|${B.key}`)).toMatchObject({
      mode: "transit",
      estimated: false,
      walkM: null,
    });
    const saved = [...cache.store.values()].filter((e) => e.timeBucket === "weekday-09");
    expect(saved).toHaveLength(6);
  });

  it("キャッシュですべてそろえば呼ばず、休日・別の時間帯のキャッシュは使わない", async () => {
    const cache = fakeTravelCache(fullCacheEntries([ORIGIN, A], "transit", "weekday-09"));
    const compute = routesOk();
    const deps = { ...NO_MOCK, computeRouteMatrix: compute, transitEnabled: true };
    const hit = await getTravelMatrix(
      { travelCache: cache, apiUsage: fakeUsage() },
      [ORIGIN, A],
      TRANSIT,
      deps,
    );
    expect(compute).not.toHaveBeenCalled();
    expect(hit.externalCalls).toBe(0);
    await getTravelMatrix(
      { travelCache: cache, apiUsage: fakeUsage() },
      [ORIGIN, A],
      { ...TRANSIT, date: "2026-11-07" },
      deps,
    );
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("ROUTE_EXISTS でない区間は徒歩の値（キャッシュか概算）にする", async () => {
    const walkCache: Entry = {
      fromKey: A.key,
      toKey: B.key,
      mode: "walking",
      timeBucket: "any",
      durationSec: 900,
      distanceM: 1100,
    };
    const cache = fakeTravelCache([walkCache]);
    const compute = vi.fn(async () => [
      {
        originIndex: 0,
        destinationIndex: 0,
        durationSec: null,
        distanceM: null,
        condition: "ROUTE_NOT_FOUND",
      },
      {
        originIndex: 1,
        destinationIndex: 1,
        durationSec: null,
        distanceM: null,
        condition: "ROUTE_NOT_FOUND",
      },
    ]);
    const r = await getTravelMatrix({ travelCache: cache, apiUsage: fakeUsage() }, [A, B], TRANSIT, {
      ...NO_MOCK,
      computeRouteMatrix: compute,
      transitEnabled: true,
    });
    expect(r.matrix.get(`${A.key}|${B.key}`)).toEqual({
      durationSec: 900,
      distanceM: 1100,
      estimated: false,
      mode: "walking",
      walkM: 1100,
    });
    expect(r.matrix.get(`${B.key}|${A.key}`)).toMatchObject({ mode: "walking", estimated: true });
    // 徒歩にした区間は公共交通のキャッシュに入れない
    expect([...cache.store.values()].filter((e) => e.mode === "transit")).toHaveLength(0);
  });

  it("遠すぎて徒歩でも行けない区間（50km 超）は区間なし（no_route）", async () => {
    const far: TravelPoint = { key: spotKey("far"), lat: 26.2, lng: 127.7 };
    const compute = vi.fn(async () => []);
    const r = await getTravelMatrix(
      { travelCache: fakeTravelCache(), apiUsage: fakeUsage() },
      [A, far],
      TRANSIT,
      {
        ...NO_MOCK,
        computeRouteMatrix: compute,
        transitEnabled: true,
      },
    );
    expect(r.matrix.size).toBe(0);
  });

  it("キー無し・上流エラーは 15km/h＋待ち 10 分の概算（estimated）", async () => {
    const none = await getTravelMatrix(
      { travelCache: fakeTravelCache(), apiUsage: fakeUsage() },
      [ORIGIN, A],
      TRANSIT,
      {
        ...NO_MOCK,
        transitEnabled: false,
      },
    );
    const leg = none.matrix.get(`${ORIGIN.key}|${A.key}`)!;
    expect(leg).toMatchObject({ mode: "transit", estimated: true, walkM: null });
    expect(leg.durationSec).toBe(Math.round(leg.distanceM / (15000 / 3600)) + 600);
    expect(none.estimated).toBe(true);

    vi.spyOn(console, "error").mockImplementation(() => {});
    const usage = fakeUsage();
    const failing = vi.fn(async () => {
      throw new Error("boom");
    });
    const err = await getTravelMatrix(
      { travelCache: fakeTravelCache(), apiUsage: usage },
      [ORIGIN, A],
      TRANSIT,
      {
        ...NO_MOCK,
        computeRouteMatrix: failing,
        transitEnabled: true,
      },
    );
    expect(err.estimated).toBe(true);
    expect(err.matrix.size).toBe(2);
  });

  it("上限に達したら呼ばずに概算にする（入口の停止中チェックは services）", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const usage = fakeUsage();
    const now = new Date("2026-10-10T03:00:00Z");
    const { provider, feature, limit } = USAGE_LIMITS.google_routes_transit;
    await usage.set(provider, feature, "2026-10", Math.ceil(limit * 0.8) - 1, limit);
    const compute = routesOk();
    const r = await getTravelMatrix(
      { travelCache: fakeTravelCache(), apiUsage: usage },
      [ORIGIN, A],
      TRANSIT,
      {
        ...NO_MOCK,
        computeRouteMatrix: compute,
        transitEnabled: true,
        now,
        notify: async () => {},
      },
    );
    expect(compute).not.toHaveBeenCalled();
    expect(r.estimated).toBe(true);
    expect((await usage.get(provider, feature, "2026-10"))?.suspendedAt).toBeTruthy();
  });
});

describe("モック（F-8-8）", () => {
  it("外部を呼ばず、回数を数えず、キャッシュにも入れない", async () => {
    const cache = fakeTravelCache();
    const usage = fakeUsage();
    const compute = routesOk();
    const fetchMatrix = vi.fn();
    for (const q of [TRANSIT, WALK]) {
      const r = await getTravelMatrix({ travelCache: cache, apiUsage: usage }, [ORIGIN, A], q, {
        mock: true,
        computeRouteMatrix: compute,
        fetchMatrix,
        transitEnabled: true,
        routingEnabled: true,
      });
      expect(r.matrix.size).toBe(2);
      expect(r.externalCalls).toBe(0);
    }
    expect(compute).not.toHaveBeenCalled();
    expect(fetchMatrix).not.toHaveBeenCalled();
    expect(usage.rows.size).toBe(0);
    expect(cache.store.size).toBe(0);
  });
});

describe("getLegsOffline（再計算）", () => {
  it("連続する区間をキャッシュから引き、無い区間は概算。外部は呼ばない", async () => {
    const cache = fakeTravelCache([
      {
        fromKey: ORIGIN.key,
        toKey: A.key,
        mode: "transit",
        timeBucket: "weekday-09",
        durationSec: 720,
        distanceM: 3000,
      },
    ]);
    const m = await getLegsOffline({ travelCache: cache }, [ORIGIN, A, B], TRANSIT, NO_MOCK);
    expect(m.size).toBe(2);
    expect(m.get(`${ORIGIN.key}|${A.key}`)).toMatchObject({
      durationSec: 720,
      estimated: false,
      mode: "transit",
    });
    expect(m.get(`${A.key}|${B.key}`)).toMatchObject({ estimated: true, mode: "transit" });
  });
});
