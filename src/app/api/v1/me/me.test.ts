/**
 * /api/v1/me 系 Route Handler のテスト（memory モード）。
 * server-only と next/headers をモックし、開発用ログイン Cookie で認証する。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

/** テストごとに差し替える Cookie の値（DEV_USER_COOKIE） */
const cookieState: { userId: string | null; set: { name: string; value: string; maxAge?: number }[] } = {
  userId: null,
  set: [],
};

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "dokoiko_dev_user" && cookieState.userId ? { name, value: cookieState.userId } : undefined,
    getAll: () => (cookieState.userId ? [{ name: "dokoiko_dev_user", value: cookieState.userId }] : []),
    set: (cookie: { name: string; value: string; maxAge?: number }) => {
      cookieState.set.push(cookie);
      if (cookie.name === "dokoiko_dev_user" && cookie.maxAge === 0) cookieState.userId = null;
    },
    delete: () => undefined,
  }),
}));

const { SEED_USER_IDS, createMemoryRepository } = await import("@/lib/repo/memory");
const { GET: getMe, PATCH: patchMe, DELETE: deleteMe } = await import("./route");
const { POST: postProfile } = await import("./profile/route");
const { GET: getPosts } = await import("./posts/route");

const ctx = { params: Promise.resolve({}) };
const BASE = "http://localhost:3000/api/v1/me";

function req(method: string, path = "", body?: unknown): NextRequest {
  return new NextRequest(`${BASE}${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** API が使う globalThis のシングルトンを毎回 seed 済みの新しいインスタンスへ差し替える */
const GLOBAL_KEY = "__dokoiko_memory_repo__";
function resetRepo() {
  const g = globalThis as Record<string, unknown>;
  const key =
    Object.keys(g).find((k) => k.toLowerCase().includes("memory") && k.includes("dokoiko")) ?? GLOBAL_KEY;
  g[key] = createMemoryRepository(true, { persist: false });
  return g[key] as ReturnType<typeof createMemoryRepository>;
}

beforeEach(() => {
  cookieState.userId = null;
  cookieState.set = [];
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /me", () => {
  it("未ログインは 401", async () => {
    const res = await getMe(req("GET"), ctx);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("ログイン中はユーザーとプロフィールを返す", async () => {
    resetRepo();
    cookieState.userId = SEED_USER_IDS.userA;
    const res = await getMe(req("GET"), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.id).toBe(SEED_USER_IDS.userA);
    expect(body.user.isAdmin).toBe(false);
    expect(body.profile.id).toBe(SEED_USER_IDS.userA);
    expect(typeof body.profile.displayName).toBe("string");
  });
});

describe("PATCH /me", () => {
  it("表示名とアイコン URL を更新する", async () => {
    resetRepo();
    cookieState.userId = SEED_USER_IDS.userA;
    const res = await patchMe(
      req("PATCH", "", { displayName: "  新しい名前 ", avatarUrl: "https://example.com/a.png" }),
      ctx,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.displayName).toBe("新しい名前");
    expect(body.avatarUrl).toBe("https://example.com/a.png");
  });

  it("avatarUrl に null を渡すと既定のアイコンに戻る", async () => {
    resetRepo();
    cookieState.userId = SEED_USER_IDS.userA;
    const res = await patchMe(req("PATCH", "", { avatarUrl: null }), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).avatarUrl).toBeNull();
  });

  it("21 文字の表示名は 400、不正な URL も 400", async () => {
    resetRepo();
    cookieState.userId = SEED_USER_IDS.userA;
    const tooLong = await patchMe(req("PATCH", "", { displayName: "あ".repeat(21) }), ctx);
    expect(tooLong.status).toBe(400);
    expect((await tooLong.json()).error.code).toBe("VALIDATION_ERROR");
    const badUrl = await patchMe(req("PATCH", "", { avatarUrl: "not-a-url" }), ctx);
    expect(badUrl.status).toBe(400);
  });

  it("JSON でないボディは 400", async () => {
    resetRepo();
    cookieState.userId = SEED_USER_IDS.userA;
    const res = await patchMe(new NextRequest(BASE, { method: "PATCH", body: "oops" }), ctx);
    expect(res.status).toBe(400);
  });
});

describe("POST /me/profile", () => {
  it("既にプロフィールがあれば表示名だけ更新して 200", async () => {
    resetRepo();
    cookieState.userId = SEED_USER_IDS.userB;
    const res = await postProfile(req("POST", "/profile", { displayName: "たびこ" }), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).displayName).toBe("たびこ");
  });

  it("空の表示名は 400", async () => {
    resetRepo();
    cookieState.userId = SEED_USER_IDS.userB;
    const res = await postProfile(req("POST", "/profile", { displayName: "   " }), ctx);
    expect(res.status).toBe(400);
  });
});

describe("GET /me/posts", () => {
  it("自分の投稿だけを新着順で返し、カーソルで続きが取れる", async () => {
    resetRepo();
    cookieState.userId = SEED_USER_IDS.userA;
    const first = await getPosts(req("GET", "/posts?limit=3"), ctx);
    expect(first.status).toBe(200);
    const page1 = await first.json();
    expect(page1.items.length).toBeLessThanOrEqual(3);
    expect(page1.items.every((p: { userId: string }) => p.userId === SEED_USER_IDS.userA)).toBe(true);
    for (let i = 1; i < page1.items.length; i++) {
      expect(page1.items[i - 1].createdAt >= page1.items[i].createdAt).toBe(true);
    }
    if (page1.nextCursor) {
      const second = await getPosts(
        req("GET", `/posts?limit=3&cursor=${encodeURIComponent(page1.nextCursor)}`),
        ctx,
      );
      const page2 = await second.json();
      const ids1 = new Set(page1.items.map((p: { id: string }) => p.id));
      expect(page2.items.some((p: { id: string }) => ids1.has(p.id))).toBe(false);
    }
  });

  it("limit が範囲外なら 400", async () => {
    resetRepo();
    cookieState.userId = SEED_USER_IDS.userA;
    const res = await getPosts(req("GET", "/posts?limit=999"), ctx);
    expect(res.status).toBe(400);
  });
});

describe("DELETE /me（退会）", () => {
  it("投稿・リスト・プロフィールを消し、Cookie を削除して 204", async () => {
    const repo = resetRepo();
    cookieState.userId = SEED_USER_IDS.userB;
    const before = await repo.posts.listByUser(SEED_USER_IDS.userB, { limit: 50 }, SEED_USER_IDS.userB);
    expect(before.items.length).toBeGreaterThan(0);
    const deleteObjects = vi.spyOn(repo.storage, "deleteObjects");

    const res = await deleteMe(req("DELETE"), ctx);
    expect(res.status).toBe(204);

    expect(await repo.profiles.getById(SEED_USER_IDS.userB)).toBeNull();
    const after = await repo.posts.listByUser(SEED_USER_IDS.userB, { limit: 50 }, SEED_USER_IDS.userB);
    expect(after.items).toHaveLength(0);
    expect(await repo.wishlists.listByUser(SEED_USER_IDS.userB)).toHaveLength(0);
    expect(deleteObjects).toHaveBeenCalledTimes(1);
    expect(deleteObjects.mock.calls[0][0].length).toBeGreaterThan(0);
    // Cookie が削除されている（maxAge: 0）
    expect(cookieState.set.some((c) => c.name === "dokoiko_dev_user" && c.maxAge === 0)).toBe(true);
    // 以後は未ログイン扱い
    const me = await getMe(req("GET"), ctx);
    expect(me.status).toBe(401);
  });
});
