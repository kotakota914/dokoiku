/**
 * /api/v1/plans 系 Route Handler のテスト（memory モード）。
 * server-only と next/headers をモックし、開発用ログイン Cookie で認証する。外部 API のキーは設定しない（概算）。
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

const { SEED_USER_IDS, createMemoryRepository } = await import("@/lib/repo/memory");
const { seedUuid } = await import("@/lib/repo/memory/seed");
const { resetRateLimits } = await import("@/lib/api/ratelimit");
const { POST: compute } = await import("./compute/route");
const { POST: chat } = await import("./chat/route");
const { POST: recompute } = await import("./recompute/route");
const { POST: save } = await import("./route");
const { GET: getPlan, DELETE: deletePlan } = await import("./[planId]/route");
const { GET: systemStatus } = await import("../system/status/route");

const ctx = { params: Promise.resolve({}) };
const SPOTS = [seedUuid("spot", 1), seedUuid("spot", 2)];

function req(path: string, method = "POST", body?: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000/api/v1${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function resetRepo() {
  const g = globalThis as Record<string, unknown>;
  const key = "__dokoiko_memory_repository__";
  g[key] = createMemoryRepository(true, { persist: false });
  return g[key] as ReturnType<typeof createMemoryRepository>;
}

async function listWithSpots(repo: ReturnType<typeof createMemoryRepository>) {
  const list = await repo.wishlists.create({ userId: SEED_USER_IDS.userA, name: "金沢" });
  for (const id of SPOTS) await repo.wishlists.addItem(list.id, id);
  return list.id;
}

function computeBody(listId: string, extra: Record<string, unknown> = {}) {
  return {
    listId,
    spotIds: SPOTS,
    origin: { lat: 36.578, lng: 136.6478, label: "金沢駅" },
    destination: { lat: 36.578, lng: 136.6478, label: "金沢駅" },
    date: "2026-11-04",
    startTime: "09:00",
    endTime: "18:00",
    mode: "transit",
    lunchBreak: true,
    method: "auto",
    ...extra,
  };
}

beforeEach(() => {
  cookieState.userId = null;
  resetRateLimits();
  delete process.env.ORS_API_KEY;
  delete process.env.GOOGLE_ROUTES_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.EXTERNAL_API_MOCK;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /plans/compute", () => {
  it("未ログインは 401", async () => {
    resetRepo();
    expect((await compute(req("/plans/compute", "POST", {}), ctx)).status).toBe(401);
  });

  it("最大 3 案を返し、1 分に 4 回目は 429 RATE_LIMITED", async () => {
    const repo = resetRepo();
    const listId = await listWithSpots(repo);
    cookieState.userId = SEED_USER_IDS.userA;
    const res = await compute(req("/plans/compute", "POST", computeBody(listId)), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.travelMatrixId).toMatch(/^tm_transit_/);
    expect(body.candidates.length).toBeGreaterThan(0);
    expect(body.candidates[0]).toMatchObject({ id: "c1", kind: "fewest_moves" });
    expect(body.candidates[0].notes).toContain("公共交通の移動時間は目安です");
    await compute(req("/plans/compute", "POST", computeBody(listId)), ctx);
    await compute(req("/plans/compute", "POST", computeBody(listId)), ctx);
    const limited = await compute(req("/plans/compute", "POST", computeBody(listId)), ctx);
    expect(limited.status).toBe(429);
    expect((await limited.json()).error.code).toBe("RATE_LIMITED");
  });

  it("入らなければ 200 で candidates: []、9 か所は 400", async () => {
    const repo = resetRepo();
    const listId = await listWithSpots(repo);
    cookieState.userId = SEED_USER_IDS.userA;
    const res = await compute(req("/plans/compute", "POST", computeBody(listId, { endTime: "09:05" })), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.candidates).toEqual([]);
    expect(body.skipped).toHaveLength(2);
    const nine = Array.from({ length: 9 }, (_, i) => seedUuid("spot", i + 1));
    const bad = await compute(req("/plans/compute", "POST", computeBody(listId, { spotIds: nine })), ctx);
    expect(bad.status).toBe(400);
  });
});

describe("POST /plans/chat", () => {
  it("Gemini 未設定なら 503 FEATURE_SUSPENDED（ai_chat）。1 分に 6 回目は 429", async () => {
    const repo = resetRepo();
    const listId = await listWithSpots(repo);
    cookieState.userId = SEED_USER_IDS.userA;
    const body = {
      listId,
      spotIds: SPOTS,
      date: "2026-11-04",
      startTime: "09:00",
      endTime: "18:00",
      messages: [{ role: "user", content: "ゆっくり回りたい" }],
    };
    const res = await chat(req("/plans/chat", "POST", body), ctx);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatchObject({
      code: "FEATURE_SUSPENDED",
      details: { feature: "ai_chat" },
    });
    for (let i = 0; i < 4; i += 1) await chat(req("/plans/chat", "POST", body), ctx);
    expect((await chat(req("/plans/chat", "POST", body), ctx)).status).toBe(429);
  });

  it("モック（EXTERNAL_API_MOCK=true）なら固定応答で 200", async () => {
    process.env.EXTERNAL_API_MOCK = "true";
    const repo = resetRepo();
    const listId = await listWithSpots(repo);
    cookieState.userId = SEED_USER_IDS.userA;
    const res = await chat(
      req("/plans/chat", "POST", {
        listId,
        spotIds: SPOTS,
        date: "2026-11-04",
        startTime: "09:00",
        endTime: "18:00",
        messages: [{ role: "user", content: "ゆっくり回りたい" }],
      }),
      ctx,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ unclear: false, conditions: { pace: "relaxed" } });
  });
});

describe("recompute → 保存 → GET（ナビ URL）→ DELETE", () => {
  it("再計算した案を保存でき、GET は各区間の navUrl を返す", async () => {
    const repo = resetRepo();
    const listId = await listWithSpots(repo);
    cookieState.userId = SEED_USER_IDS.userA;
    const params = computeBody(listId);
    const computed = await (await compute(req("/plans/compute", "POST", params), ctx)).json();
    const c1 = computed.candidates[0];
    const order = c1.items
      .filter((i: { type: string }) => i.type === "spot")
      .map((i: { spotId: string }) => i.spotId)
      .reverse();
    const r = await recompute(
      req("/plans/recompute", "POST", {
        params,
        travelMatrixId: computed.travelMatrixId,
        order,
        candidate: { id: c1.id, kind: c1.kind, label: c1.label },
      }),
      ctx,
    );
    expect(r.status).toBe(200);
    const result = await r.json();
    expect(result).toMatchObject({ id: "c1", kind: c1.kind, label: c1.label });

    const saved = await save(req("/plans", "POST", { params, result }), ctx);
    expect(saved.status).toBe(201);
    const plan = await saved.json();
    expect(plan.params.method).toBe("auto");

    const planCtx = { params: Promise.resolve({ planId: plan.id }) };
    const got = await getPlan(req(`/plans/${plan.id}`, "GET"), planCtx);
    expect(got.status).toBe(200);
    const detail = await got.json();
    // 出発地 → 2 か所 → 到着地（昼食は区間に含めない）
    expect(detail.segments).toHaveLength(3);
    for (const s of detail.segments) {
      expect(s.navUrl).toMatch(
        /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&origin=[\d.-]+,[\d.-]+&destination=[\d.-]+,[\d.-]+&travelmode=transit$/,
      );
    }
    expect(detail.segments[0].fromIndex).toBe(-1);
    expect(detail.segments[2].toIndex).toBe(plan.result.items.length);

    cookieState.userId = SEED_USER_IDS.userB;
    expect((await getPlan(req(`/plans/${plan.id}`, "GET"), planCtx)).status).toBe(403);
    cookieState.userId = SEED_USER_IDS.userA;
    expect((await deletePlan(req(`/plans/${plan.id}`, "DELETE"), planCtx)).status).toBe(204);
    expect((await getPlan(req(`/plans/${plan.id}`, "GET"), planCtx)).status).toBe(404);
  });
});

describe("GET /system/status", () => {
  it("capabilities に transit / ai を含め、キーが無ければ false", async () => {
    resetRepo();
    const res = await systemStatus(req("/system/status", "GET"), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.capabilities).toMatchObject({ routing: false, transit: false, ai: false, backend: "memory" });
    expect(body.suspended).toEqual([]);
  });
});
