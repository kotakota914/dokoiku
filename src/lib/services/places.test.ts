/**
 * 場所検索（自前DB優先＋Nominatim）の service と Route Handler のテスト。
 * Nominatim の fetch は必ずモックし、ネットワークには出ない。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetRateLimits } from "@/lib/api/ratelimit";
import { USAGE_LIMITS } from "@/lib/domain/constants";
import type { PlaceCandidate } from "@/lib/domain/types";
import { resetNominatimThrottleForTests, type NominatimPlace } from "@/lib/external/nominatim";
import type { FetchLike } from "@/lib/external/notify";
import { periodFor } from "@/lib/external/usage";
import { createMemoryRepository, SEED_USER_IDS } from "@/lib/repo/memory";
import { seedUuid } from "@/lib/repo/memory/seed";
import { placesSearchQuerySchema } from "@/lib/validation/schemas";
import { dedupeExternal, isSamePlace, searchPlaceCandidates, toDbCandidate } from "./places";

vi.mock("server-only", () => ({}));

const authState: { userId: string | null } = { userId: null };
vi.mock("@/lib/auth/server", () => ({
  getCurrentUser: async () => (authState.userId ? { id: authState.userId, isAdmin: false } : null),
  requireUser: async () => {
    if (!authState.userId) {
      const { ApiError } = await import("@/lib/api/errors");
      throw ApiError.unauthorized();
    }
    return { id: authState.userId, isAdmin: false };
  },
}));
let repo = createMemoryRepository(true, { persist: false });
vi.mock("@/lib/repo", () => ({ getRepo: async () => repo }));

const NOW = new Date("2026-10-10T03:00:00Z"); // JST 12:00
const KIYOMIZU_ID = seedUuid("spot", 1);

/** 自前DBの清水寺と同じ場所（座標が数 m 違い、表記ゆれあり） */
const EXT_KIYOMIZU: NominatimPlace = {
  place_id: 10,
  osm_type: "way",
  osm_id: 1001,
  lat: "34.99492",
  lon: "135.78503",
  name: "清水寺 ",
  display_name: "清水寺, 清水1丁目, 東山区, 京都市, 京都府, 日本",
  address: { state: "京都府", city: "京都市", city_district: "東山区" },
};
const EXT_STATION: NominatimPlace = {
  place_id: 11,
  osm_type: "node",
  osm_id: 1002,
  lat: "34.9858",
  lon: "135.7588",
  name: "清水寺前バス停",
  display_name: "清水寺前バス停, 下京区, 京都市, 京都府, 日本",
  address: { state: "京都府", city: "京都市", city_district: "下京区" },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** 本物の fetch を使わせない */
let realFetch: typeof fetch;
let guardedFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  repo = createMemoryRepository(true, { persist: false });
  authState.userId = null;
  resetRateLimits();
  resetNominatimThrottleForTests();
  realFetch = globalThis.fetch;
  guardedFetch = vi.fn(async () => {
    throw new Error("network access is not allowed in tests");
  });
  globalThis.fetch = guardedFetch as unknown as typeof fetch;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

async function usageCount(): Promise<number> {
  const { provider, feature } = USAGE_LIMITS.nominatim;
  return (await repo.apiUsage.get(provider, feature, periodFor("nominatim", NOW)))?.count ?? 0;
}

describe("isSamePlace / dedupeExternal", () => {
  const db: PlaceCandidate = {
    source: "db",
    id: "x",
    name: "清水寺",
    lat: 34.9949,
    lng: 135.785,
    address: null,
    prefecture: null,
    city: null,
  };
  it("50m 以内かつ正規化した名前が一致なら同じ場所", () => {
    expect(
      isSamePlace({ ...db, source: "external", name: "きよみず寺", lat: 34.99492, lng: 135.78503 }, db),
    ).toBe(false);
    expect(
      isSamePlace({ ...db, source: "external", name: "清水寺　", lat: 34.99492, lng: 135.78503 }, db),
    ).toBe(true);
    expect(isSamePlace({ ...db, source: "external", name: "清水寺", lat: 34.996, lng: 135.785 }, db)).toBe(
      false,
    );
  });
  it("同じ場所の外部候補だけを除く", () => {
    const keep: PlaceCandidate = { ...db, source: "external", id: "k", name: "別の場所" };
    const drop: PlaceCandidate = { ...db, source: "external", id: "d" };
    expect(dedupeExternal([keep, drop], [db])).toEqual([keep]);
  });
});

describe("searchPlaceCandidates", () => {
  it("自前DBの結果を先頭に、外部の結果を続けて返し、同じ場所は除く。無料枠を 1 回分数える", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse([EXT_KIYOMIZU, EXT_STATION]));
    const res = await searchPlaceCandidates(
      repo,
      { q: "清水寺" },
      { now: NOW, fetchImpl, nominatimEnabled: true },
    );
    expect(res.externalUnavailable).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(guardedFetch).not.toHaveBeenCalled();

    const db = res.results.filter((r) => r.source === "db");
    const ext = res.results.filter((r) => r.source === "external");
    expect(db[0]).toMatchObject({ source: "db", id: KIYOMIZU_ID, name: "清水寺", prefecture: "京都府" });
    expect(res.results.indexOf(db[0])).toBeLessThan(res.results.indexOf(ext[0]));
    expect(ext.map((e) => e.id)).toEqual(["node:1002"]);
    expect(await usageCount()).toBe(1);
  });

  it("自前DBの候補は人気順で最大 10 件、PlaceCandidate の形にする", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse([]));
    const res = await searchPlaceCandidates(
      repo,
      { q: "寺" },
      { now: NOW, fetchImpl, nominatimEnabled: true },
    );
    const db = res.results.filter((r) => r.source === "db");
    expect(db.length).toBeGreaterThan(1);
    expect(db.length).toBeLessThanOrEqual(10);
    const spot = await repo.spots.getById(KIYOMIZU_ID);
    expect(toDbCandidate(spot!)).toEqual({
      source: "db",
      id: KIYOMIZU_ID,
      name: "清水寺",
      lat: 34.9949,
      lng: 135.785,
      address: null,
      prefecture: "京都府",
      city: "京都市東山区",
    });
  });

  it("現在地があれば Nominatim の結果を近い順に並べる", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse([EXT_STATION, { ...EXT_KIYOMIZU, name: "清水寺本堂" }]),
    );
    const res = await searchPlaceCandidates(
      repo,
      { q: "清水寺", lat: 34.9949, lng: 135.785 },
      { now: NOW, fetchImpl, nominatimEnabled: true },
    );
    const ext = res.results.filter((r) => r.source === "external");
    expect(ext.map((e) => e.name)).toEqual(["清水寺本堂", "清水寺前バス停"]);
  });

  it("外部が失敗（UPSTREAM）したら externalUnavailable: true で自前DBの結果だけ返す（例外にしない）", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ error: "down" }, 503));
    const res = await searchPlaceCandidates(
      repo,
      { q: "清水寺" },
      { now: NOW, fetchImpl, nominatimEnabled: true },
    );
    expect(res.externalUnavailable).toBe(true);
    expect(res.results.length).toBeGreaterThan(0);
    expect(res.results.every((r) => r.source === "db")).toBe(true);
    expect(console.warn).toHaveBeenCalled();
  });

  it("外部検索が停止中なら Nominatim を呼ばず externalUnavailable: true", async () => {
    const { provider, feature } = USAGE_LIMITS.nominatim;
    const period = periodFor("nominatim", NOW);
    await repo.apiUsage.increment(provider, feature, period, USAGE_LIMITS.nominatim.limit, 400);
    await repo.apiUsage.setSuspended(provider, feature, period, "2026-10-10T11:00:00.000+09:00");
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse([EXT_STATION]));
    const res = await searchPlaceCandidates(
      repo,
      { q: "清水寺" },
      { now: NOW, fetchImpl, nominatimEnabled: true },
    );
    expect(res.externalUnavailable).toBe(true);
    expect(res.results.every((r) => r.source === "db")).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await usageCount()).toBe(400);
  });

  it("無料枠の 80% に達した呼び出しは停止にして externalUnavailable: true（200 のまま）", async () => {
    const { provider, feature, limit } = USAGE_LIMITS.nominatim;
    const period = periodFor("nominatim", NOW);
    await repo.apiUsage.increment(provider, feature, period, limit, Math.ceil(limit * 0.8) - 1);
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse([EXT_STATION]));
    const res = await searchPlaceCandidates(
      repo,
      { q: "清水寺" },
      { now: NOW, fetchImpl, nominatimEnabled: true },
    );
    expect(res.externalUnavailable).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
    const row = await repo.apiUsage.get(provider, feature, period);
    expect(row?.suspendedAt).toBeTruthy();
  });

  it("Nominatim が無効（NOMINATIM_ENABLED=false）なら自前DBのみ", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse([EXT_STATION]));
    const res = await searchPlaceCandidates(
      repo,
      { q: "清水寺" },
      { now: NOW, fetchImpl, nominatimEnabled: false },
    );
    expect(res.externalUnavailable).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await usageCount()).toBe(0);
  });

  it("外部検索は 1 秒に 1 回：2 回目は 429、1 秒後は通る", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse([EXT_STATION]));
    const first = await searchPlaceCandidates(
      repo,
      { q: "清水寺" },
      { now: NOW, fetchImpl, nominatimEnabled: true },
    );
    expect(first.externalUnavailable).toBe(false);

    const soon = new Date(NOW.getTime() + 100);
    await expect(
      searchPlaceCandidates(repo, { q: "清水寺" }, { now: soon, fetchImpl, nominatimEnabled: true }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await usageCount()).toBe(1);

    resetNominatimThrottleForTests();
    const later = new Date(NOW.getTime() + 1000);
    const third = await searchPlaceCandidates(
      repo,
      { q: "清水寺" },
      { now: later, fetchImpl, nominatimEnabled: true },
    );
    expect(third.externalUnavailable).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("GET /places/search", () => {
  const BASE = "http://localhost:3000/api/v1";
  const get = (path: string) => new NextRequest(`${BASE}${path}`, { method: "GET" });
  const ctx = { params: Promise.resolve({}) };

  it("未ログインは 401", async () => {
    const { GET } = await import("@/app/api/v1/places/search/route");
    const res = await GET(get("/places/search?q=清水寺"), ctx);
    expect(res.status).toBe(401);
  });

  it("q は必須（空は 400）", async () => {
    const { GET } = await import("@/app/api/v1/places/search/route");
    authState.userId = SEED_USER_IDS.userA;
    const res = await GET(get("/places/search?q=%20"), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    expect(placesSearchQuerySchema.safeParse({ q: "" }).success).toBe(false);
  });

  it("Nominatim が無効なら自前DBだけで 200（externalUnavailable: true）", async () => {
    const { GET } = await import("@/app/api/v1/places/search/route");
    authState.userId = SEED_USER_IDS.userA;
    vi.stubEnv("NOMINATIM_ENABLED", "false");
    try {
      const res = await GET(get("/places/search?q=清水寺"), ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      const body = await res.json();
      expect(body.externalUnavailable).toBe(true);
      expect(body.results[0]).toMatchObject({ source: "db", name: "清水寺" });
      expect(guardedFetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
