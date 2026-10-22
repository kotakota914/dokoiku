/**
 * スポット API の service と Route Handler のテスト（memory モード、seed あり）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { LIMITS, MAP_ZOOM, TILE_CACHE_MAX_AGE_SEC, TILE_MAX_SPOTS } from "@/lib/domain/constants";
import { lngLatToTile, tileToBbox } from "@/lib/map/tiles";
import { inBbox as pointInBbox } from "@/lib/utils/geo";
import { createMemoryRepository, SEED_USER_IDS } from "@/lib/repo/memory";
import { seedUuid } from "@/lib/repo/memory/seed";
import { nearbyQuerySchema, spotSearchQuerySchema, spotsInViewQuerySchema } from "@/lib/validation/schemas";
import {
  canCreateSpot,
  getNearbySpots,
  getSpotDetail,
  getSpotsInTile,
  getSpotsInView,
  listSpotPosts,
  searchSpots,
} from "./spots";

vi.mock("server-only", () => ({}));

/** 認証と Repository を差し替える（Route Handler のテスト用） */
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

/** 金沢市・野々市市をおおむね含む範囲 */
const KANAZAWA_BBOX = "136.55,36.48,136.75,36.65";
const KENROKUEN_ID = seedUuid("spot", 1);
const KENROKUEN = { lat: 36.5619, lng: 136.6625 };
const UNKNOWN_ID = "b0000000-0000-4000-8000-ffffffffffff";

beforeEach(() => {
  repo = createMemoryRepository(true, { persist: false });
  authState.userId = null;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("getSpotsInView", () => {
  it("zoom 9 以上はスポット一覧を投稿数の多い順で返す", async () => {
    const q = spotsInViewQuerySchema.parse({ bbox: KANAZAWA_BBOX, zoom: "13" });
    const res = await getSpotsInView(repo, q);
    expect(res.mode).toBe("spots");
    if (res.mode !== "spots") throw new Error("unreachable");
    expect(res.spots.length).toBeGreaterThan(10);
    expect(res.spots.length).toBeLessThanOrEqual(LIMITS.mapMaxSpots);
    for (let i = 1; i < res.spots.length; i++) {
      expect(res.spots[i - 1].postCount).toBeGreaterThanOrEqual(res.spots[i].postCount);
    }
    expect(res.spots.every((s) => s.postCount > 0)).toBe(true);
    expect(res.spots[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      popularity: "very_popular",
    });
  });

  it("zoom 8 以下はヒートマップ用の点（weight = 投稿数）", async () => {
    const q = spotsInViewQuerySchema.parse({ bbox: KANAZAWA_BBOX, zoom: String(MAP_ZOOM.heatmapMax) });
    const res = await getSpotsInView(repo, q);
    expect(res.mode).toBe("heatmap");
    if (res.mode !== "heatmap") throw new Error("unreachable");
    expect(res.points.length).toBeGreaterThan(0);
    expect(res.points[0]).toEqual({
      lat: expect.any(Number),
      lng: expect.any(Number),
      weight: expect.any(Number),
    });
    expect(res.points.every((p) => p.weight > 0)).toBe(true);

    const nine = await getSpotsInView(repo, spotsInViewQuerySchema.parse({ bbox: KANAZAWA_BBOX, zoom: "9" }));
    expect(nine.mode).toBe("spots");
  });

  it("category はカンマ区切りで絞り込める", async () => {
    const q = spotsInViewQuerySchema.parse({ bbox: KANAZAWA_BBOX, zoom: "14", category: "gourmet,nature" });
    const res = await getSpotsInView(repo, q);
    if (res.mode !== "spots") throw new Error("unreachable");
    expect(res.spots.length).toBeGreaterThan(0);
    expect(res.spots.every((s) => s.category === "gourmet" || s.category === "nature")).toBe(true);
  });

  it("範囲外なら空", async () => {
    const q = spotsInViewQuerySchema.parse({ bbox: "139.5,35.5,139.9,35.9", zoom: "14" });
    const res = await getSpotsInView(repo, q);
    expect(res).toEqual({ mode: "spots", spots: [] });
  });
});

describe("getSpotsInTile（v0.3 F-1-2）", () => {
  it("z=14 は区画内のスポットを投稿数の多い順で返す（最大 TILE_MAX_SPOTS 件）", async () => {
    const tile = lngLatToTile(KENROKUEN.lng, KENROKUEN.lat, 14);
    const res = await getSpotsInTile(repo, tile);
    expect(res.mode).toBe("spots");
    if (res.mode !== "spots") throw new Error("unreachable");
    expect(res.spots.length).toBeGreaterThan(0);
    expect(res.spots.length).toBeLessThanOrEqual(TILE_MAX_SPOTS);
    expect(res.spots.some((s) => s.id === KENROKUEN_ID)).toBe(true);
    const bbox = tileToBbox(tile);
    expect(res.spots.every((s) => pointInBbox(s, bbox))).toBe(true);
    for (let i = 1; i < res.spots.length; i++) {
      expect(res.spots[i - 1].postCount).toBeGreaterThanOrEqual(res.spots[i].postCount);
    }
  });

  it("z=11 もスポット一覧。z=8 はヒートマップ用の点", async () => {
    const mid = await getSpotsInTile(repo, lngLatToTile(KENROKUEN.lng, KENROKUEN.lat, 11));
    expect(mid.mode).toBe("spots");
    const heat = await getSpotsInTile(repo, lngLatToTile(KENROKUEN.lng, KENROKUEN.lat, 8));
    expect(heat.mode).toBe("heatmap");
    if (heat.mode !== "heatmap") throw new Error("unreachable");
    expect(heat.points.length).toBeGreaterThan(0);
    expect(heat.points.every((p) => p.weight > 0)).toBe(true);
  });

  it("category で絞り込める。何もない区画は空", async () => {
    const tile = lngLatToTile(KENROKUEN.lng, KENROKUEN.lat, 11);
    const res = await getSpotsInTile(repo, tile, { category: ["gourmet"] });
    if (res.mode !== "spots") throw new Error("unreachable");
    expect(res.spots.length).toBeGreaterThan(0);
    expect(res.spots.every((s) => s.category === "gourmet")).toBe(true);
    const tokyo = await getSpotsInTile(repo, lngLatToTile(139.7671, 35.6812, 14));
    expect(tokyo).toEqual({ mode: "spots", spots: [] });
  });
});

describe("getNearbySpots / canCreateSpot", () => {
  it("accuracy 99 なら canCreate: true、100 なら false", async () => {
    expect(canCreateSpot(99)).toBe(true);
    expect(canCreateSpot(100)).toBe(false);
    const ok = await getNearbySpots(repo, nearbyQuerySchema.parse({ ...KENROKUEN, accuracy: "99" }));
    expect(ok.canCreate).toBe(true);
    const ng = await getNearbySpots(repo, nearbyQuerySchema.parse({ ...KENROKUEN, accuracy: "100" }));
    expect(ng.canCreate).toBe(false);
  });

  it("accuracy を省略（誤差不明）すると canCreate: false", async () => {
    const q = nearbyQuerySchema.parse({ ...KENROKUEN });
    expect(q.accuracy).toBeUndefined();
    const res = await getNearbySpots(repo, q);
    expect(res.canCreate).toBe(false);
    expect(res.spots.length).toBeGreaterThan(0);
  });

  it("半径内のスポットを近い順に返し、distanceM を含む", async () => {
    const res = await getNearbySpots(repo, nearbyQuerySchema.parse({ ...KENROKUEN }));
    expect(res.spots.length).toBeGreaterThan(0);
    expect(res.spots.length).toBeLessThanOrEqual(LIMITS.nearbyMax);
    expect(res.spots[0]).toMatchObject({ id: KENROKUEN_ID, name: "兼六園", distanceM: 0 });
    expect(res.spots.every((s) => s.distanceM <= LIMITS.nearbyRadiusDefaultM)).toBe(true);
    for (let i = 1; i < res.spots.length; i++) {
      expect(res.spots[i - 1].distanceM).toBeLessThanOrEqual(res.spots[i].distanceM);
    }
  });

  it("近くに何もなければ空（canCreate は誤差だけで決まる）", async () => {
    const res = await getNearbySpots(
      repo,
      nearbyQuerySchema.parse({ lat: "35.6812", lng: "139.7671", accuracy: "10" }),
    );
    expect(res).toEqual({ canCreate: true, spots: [] });
  });
});

describe("searchSpots", () => {
  it("キーワード（スポット名）で絞り込み、人気順で返す", async () => {
    const res = await searchSpots(repo, spotSearchQuerySchema.parse({ q: "兼六" }));
    expect(res.items.length).toBeGreaterThan(0);
    expect(res.items.some((s) => s.id === KENROKUEN_ID)).toBe(true);
    // 名前または住所（兼六町）に一致する
    const details = await Promise.all(res.items.map((s) => getSpotDetail(repo, s.id)));
    expect(details.every((s) => s.name.includes("兼六") || (s.address ?? "").includes("兼六"))).toBe(true);
  });

  it("市区町村・カテゴリでも絞り込め、limit とカーソルで続きが取れる", async () => {
    const page1 = await searchSpots(
      repo,
      spotSearchQuerySchema.parse({ city: "金沢市", category: "history", limit: "2" }),
    );
    expect(page1.items).toHaveLength(2);
    expect(page1.items.every((s) => s.category === "history" && s.city?.includes("金沢市"))).toBe(true);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = await searchSpots(
      repo,
      spotSearchQuerySchema.parse({
        city: "金沢市",
        category: "history",
        limit: "2",
        cursor: page1.nextCursor!,
      }),
    );
    const ids1 = new Set(page1.items.map((s) => s.id));
    expect(page2.items.some((s) => ids1.has(s.id))).toBe(false);
  });

  it("該当なしは空ページ", async () => {
    const res = await searchSpots(repo, spotSearchQuerySchema.parse({ q: "存在しないスポット名" }));
    expect(res).toEqual({ items: [], nextCursor: null });
  });
});

describe("getSpotDetail", () => {
  it("詳細を返す（住所・時間帯分布・代表写真）", async () => {
    const spot = await getSpotDetail(repo, KENROKUEN_ID);
    expect(spot.name).toBe("兼六園");
    expect(spot.hourHistogram).toHaveLength(24);
    expect(spot.address).toBeTruthy();
    expect(spot.coverThumbUrl).toBeTruthy();
    expect(spot.coverFullUrl).toBeTruthy();
    expect(spot.createdAt).toMatch(/\+09:00$/);
  });

  it("無ければ 404", async () => {
    await expect(getSpotDetail(repo, UNKNOWN_ID)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
      message: "このスポットは見つかりませんでした",
    });
  });
});

describe("listSpotPosts", () => {
  it("新着順で 20 件ずつ返し、未ログインは likedByMe が false", async () => {
    const page = await listSpotPosts(repo, KENROKUEN_ID, { limit: LIMITS.postsPageSize }, null);
    expect(page.items).toHaveLength(LIMITS.postsPageSize);
    expect(page.nextCursor).toBeTruthy();
    expect(page.items.every((p) => p.spotId === KENROKUEN_ID && p.status === "public")).toBe(true);
    expect(page.items.every((p) => p.likedByMe === false)).toBe(true);
    for (let i = 1; i < page.items.length; i++) {
      expect(page.items[i - 1].createdAt >= page.items[i].createdAt).toBe(true);
    }
    const rest = await listSpotPosts(
      repo,
      KENROKUEN_ID,
      { limit: LIMITS.postsPageSize, cursor: page.nextCursor! },
      null,
    );
    expect(rest.items.length).toBeGreaterThan(0);
    expect(rest.items.length).toBeLessThan(LIMITS.postsPageSize);
  });

  it("ログイン中は likedByMe が反映される", async () => {
    const page = await listSpotPosts(repo, KENROKUEN_ID, { limit: 50 }, SEED_USER_IDS.userA);
    expect(page.items.some((p) => p.likedByMe)).toBe(true);
  });

  it("スポットが無ければ 404", async () => {
    await expect(listSpotPosts(repo, UNKNOWN_ID, { limit: 20 }, null)).rejects.toMatchObject({ status: 404 });
  });
});

// ---------- Route Handler ----------

const BASE = "http://localhost:3000/api/v1";
const get = (path: string) => new NextRequest(`${BASE}${path}`, { method: "GET" });
const noParams = { params: Promise.resolve({}) };

describe("Route Handlers", () => {
  it("GET /system/status は停止中一覧と capabilities を返し、no-store", async () => {
    const { GET } = await import("@/app/api/v1/system/status/route");
    const res = await GET(get("/system/status"), noParams);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.suspended).toEqual([]);
    expect(body.capabilities).toMatchObject({ backend: "memory", googleLogin: false, routing: false });
  });

  it("GET /spots は bbox 必須（400）、正しければ mode を返す", async () => {
    const { GET } = await import("@/app/api/v1/spots/route");
    const bad = await GET(get("/spots?zoom=10"), noParams);
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("VALIDATION_ERROR");
    const badCat = await GET(get(`/spots?bbox=${KANAZAWA_BBOX}&zoom=10&category=foo`), noParams);
    expect(badCat.status).toBe(400);
    const ok = await GET(get(`/spots?bbox=${KANAZAWA_BBOX}&zoom=5`), noParams);
    expect(ok.status).toBe(200);
    expect((await ok.json()).mode).toBe("heatmap");
  });

  it("GET /spots/tiles/{z}/{x}/{y} は z が 8/11/14 以外や範囲外なら 400、正しければ max-age=60 付きで返す", async () => {
    const { GET } = await import("@/app/api/v1/spots/tiles/[z]/[x]/[y]/route");
    const call = (z: string, x: string, y: string, query = "") =>
      GET(get(`/spots/tiles/${z}/${x}/${y}${query}`), { params: Promise.resolve({ z, x, y }) });
    const t = lngLatToTile(KENROKUEN.lng, KENROKUEN.lat, 14);
    const ok = await call("14", String(t.x), String(t.y));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Cache-Control")).toBe(`public, max-age=${TILE_CACHE_MAX_AGE_SEC}`);
    const body = await ok.json();
    expect(body.mode).toBe("spots");
    expect(body.spots.some((s: { id: string }) => s.id === KENROKUEN_ID)).toBe(true);

    const h = lngLatToTile(KENROKUEN.lng, KENROKUEN.lat, 8);
    const heat = await call("8", String(h.x), String(h.y));
    expect((await heat.json()).mode).toBe("heatmap");

    const badZoom = await call("9", "0", "0");
    expect(badZoom.status).toBe(400);
    expect((await badZoom.json()).error.code).toBe("VALIDATION_ERROR");
    const outOfRange = await call("8", "256", "0");
    expect(outOfRange.status).toBe(400);
    const notNumber = await call("14", "abc", "0");
    expect(notNumber.status).toBe(400);
    const badCategory = await call("14", String(t.x), String(t.y), "?category=foo");
    expect(badCategory.status).toBe(400);
    const filtered = await call("14", String(t.x), String(t.y), "?category=history,nature");
    expect(filtered.status).toBe(200);
  });

  it("GET /spots/{spotId} と /spots/{spotId}/posts は ID が UUID でなければ 400、無ければ 404", async () => {
    const { GET: getSpot } = await import("@/app/api/v1/spots/[spotId]/route");
    const { GET: getSpotPosts } = await import("@/app/api/v1/spots/[spotId]/posts/route");
    const bad = await getSpot(get("/spots/abc"), { params: Promise.resolve({ spotId: "abc" }) });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("VALIDATION_ERROR");
    const badPosts = await getSpotPosts(get("/spots/abc/posts"), {
      params: Promise.resolve({ spotId: "abc" }),
    });
    expect(badPosts.status).toBe(400);
    const missing = await getSpot(get(`/spots/${UNKNOWN_ID}`), {
      params: Promise.resolve({ spotId: UNKNOWN_ID }),
    });
    expect(missing.status).toBe(404);
    const ok = await getSpot(get(`/spots/${KENROKUEN_ID}`), {
      params: Promise.resolve({ spotId: KENROKUEN_ID }),
    });
    expect(ok.status).toBe(200);
    expect((await ok.json()).name).toBe("兼六園");
  });

  it("GET /spots/nearby は未ログインなら 401、ログイン中は canCreate を返す", async () => {
    const { GET } = await import("@/app/api/v1/spots/nearby/route");
    const anon = await GET(
      get(`/spots/nearby?lat=${KENROKUEN.lat}&lng=${KENROKUEN.lng}&accuracy=50`),
      noParams,
    );
    expect(anon.status).toBe(401);
    authState.userId = SEED_USER_IDS.userA;
    const res = await GET(
      get(`/spots/nearby?lat=${KENROKUEN.lat}&lng=${KENROKUEN.lng}&accuracy=150`),
      noParams,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.canCreate).toBe(false);
    expect(body.spots[0].name).toBe("兼六園");
    const tooFar = await GET(
      get(`/spots/nearby?lat=${KENROKUEN.lat}&lng=${KENROKUEN.lng}&radius=301`),
      noParams,
    );
    expect(tooFar.status).toBe(400);
  });

  it("GET /spots/search は Page<SpotSummary>", async () => {
    const { GET } = await import("@/app/api/v1/spots/search/route");
    const res = await GET(get("/spots/search?q=鼓門&sort=newest"), noParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items[0].name).toBe("金沢駅 鼓門");
    expect(body.nextCursor).toBeNull();
  });

  it("GET /spots/{spotId} は詳細、無ければ 404", async () => {
    const { GET } = await import("@/app/api/v1/spots/[spotId]/route");
    const ok = await GET(get(`/spots/${KENROKUEN_ID}`), {
      params: Promise.resolve({ spotId: KENROKUEN_ID }),
    });
    expect(ok.status).toBe(200);
    expect((await ok.json()).name).toBe("兼六園");
    const nf = await GET(get(`/spots/${UNKNOWN_ID}`), { params: Promise.resolve({ spotId: UNKNOWN_ID }) });
    expect(nf.status).toBe(404);
    expect((await nf.json()).error).toEqual({
      code: "NOT_FOUND",
      message: "このスポットは見つかりませんでした",
    });
  });

  it("GET /spots/{spotId}/posts は未ログインでも閲覧でき、limit を検証する", async () => {
    const { GET } = await import("@/app/api/v1/spots/[spotId]/posts/route");
    const ctx = { params: Promise.resolve({ spotId: KENROKUEN_ID }) };
    const ok = await GET(get(`/spots/${KENROKUEN_ID}/posts?limit=5`), ctx);
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.items).toHaveLength(5);
    expect(body.nextCursor).toBeTruthy();
    const bad = await GET(get(`/spots/${KENROKUEN_ID}/posts?limit=0`), ctx);
    expect(bad.status).toBe(400);
    const nf = await GET(get(`/spots/${UNKNOWN_ID}/posts`), {
      params: Promise.resolve({ spotId: UNKNOWN_ID }),
    });
    expect(nf.status).toBe(404);
  });
});
