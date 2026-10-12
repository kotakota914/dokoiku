/**
 * GET /api/v1/plans/{planId}/image（旅のしおり画像）のテスト（memory モード）。
 * 日本語フォントの取得（ネットワーク）はモックし、英数フォールバックで描画する。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const cookieState: { userId: string | null } = { userId: null };

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "dokoiko_dev_user" && cookieState.userId ? { name, value: cookieState.userId } : undefined,
    getAll: () => (cookieState.userId ? [{ name: "dokoiko_dev_user", value: cookieState.userId }] : []),
    set: () => undefined,
    delete: () => undefined,
  }),
}));

const loadJapaneseFonts = vi.fn<(texts: string[], weights?: number[]) => Promise<never[]>>(async () => []);
vi.mock("@/lib/og/fonts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/og/fonts")>();
  return { ...mod, loadJapaneseFonts };
});

const { SEED_USER_IDS, createMemoryRepository } = await import("@/lib/repo/memory");
const { GET } = await import("./route");

const GLOBAL_KEY = "__dokoiko_memory_repository__";
function resetRepo() {
  const g = globalThis as Record<string, unknown>;
  const key =
    Object.keys(g).find((k) => k.toLowerCase().includes("memory") && k.includes("dokoiko")) ?? GLOBAL_KEY;
  g[key] = createMemoryRepository(true, { persist: false });
  return g[key] as ReturnType<typeof createMemoryRepository>;
}

function req(planId: string): [NextRequest, { params: Promise<{ planId: string }> }] {
  return [
    new NextRequest(`http://localhost:3000/api/v1/plans/${planId}/image`),
    { params: Promise.resolve({ planId }) },
  ];
}

async function createPlan(repo: ReturnType<typeof createMemoryRepository>, userId: string) {
  const list = await repo.wishlists.create({ userId, name: "金沢旅行" });
  const spots = await repo.spots.search({ sort: "popular", paging: { limit: 2 } });
  const [a, b] = spots.items;
  return repo.plans.create({
    userId,
    wishlistId: list.id,
    params: {
      listId: list.id,
      spotIds: [a.id, b.id],
      origin: { lat: 36.578, lng: 136.6478, label: "金沢駅" },
      destination: null,
      date: "2026-10-12",
      startTime: "09:00",
      endTime: "18:00",
      mode: "walking",
      pace: "normal",
      interests: [],
      lunchBreak: true,
    },
    result: {
      items: [
        { type: "spot", spotId: a.id, arrive: "09:20", stayMin: 60, depart: "10:20", travelMinToNext: 15, inBestTime: true },
        { type: "lunch", arrive: "11:40", stayMin: 60, depart: "12:40", travelMinToNext: 10 },
        { type: "spot", spotId: b.id, arrive: "12:50", stayMin: 90, depart: "14:20", travelMinToNext: null, inBestTime: false },
      ],
      skipped: [],
      totalTravelMin: 25,
      endAt: "14:20",
      geometry: null,
      travelMatrixId: "m1",
      estimated: true,
    },
  });
}

beforeEach(() => {
  cookieState.userId = null;
  loadJapaneseFonts.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /plans/{planId}/image", () => {
  it("未ログインは 401", async () => {
    resetRepo();
    const res = await GET(...req("00000000-0000-4000-8000-000000000000"));
    expect(res.status).toBe(401);
  });

  it("UUID でない ID は 400、無いプランは 404、他人のプランは 403", async () => {
    const repo = resetRepo();
    const plan = await createPlan(repo, SEED_USER_IDS.userB);
    cookieState.userId = SEED_USER_IDS.userA;
    expect((await GET(...req("not-a-uuid"))).status).toBe(400);
    expect((await GET(...req("00000000-0000-4000-8000-000000000000"))).status).toBe(404);
    const forbidden = await GET(...req(plan.id));
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()).error.code).toBe("FORBIDDEN");
  });

  it("本人なら 1080x1920 の PNG を返す（フォントが取れなくても描画できる）", async () => {
    const repo = resetRepo();
    const plan = await createPlan(repo, SEED_USER_IDS.userA);
    cookieState.userId = SEED_USER_IDS.userA;
    const res = await GET(...req(plan.id));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("no-store");
    const buf = Buffer.from(await res.arrayBuffer());
    // PNG シグネチャと IHDR（幅・高さ）
    expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(buf.readUInt32BE(16)).toBe(1080);
    expect(buf.readUInt32BE(20)).toBe(1920);
    expect(loadJapaneseFonts).toHaveBeenCalledTimes(1);
    const texts = loadJapaneseFonts.mock.calls[0][0];
    expect(texts).toContain("2026年10月12日");
    expect(texts).toContain("金沢駅");
  }, 30_000);
});
