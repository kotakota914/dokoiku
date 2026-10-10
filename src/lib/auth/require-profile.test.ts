/**
 * requireProfile（F-6-2）のテスト。
 * memory モードの getCurrentUser はプロフィール無しを未ログイン扱いにするため、supabase モードの認証を模擬して
 * 「ログイン済みだがプロフィール未作成」のユーザーを作り、書き込み API が 403（profile_required）になることを確認する。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => undefined }),
}));

/** 模擬する Supabase Auth のユーザー。null なら未ログイン */
const authState: { user: { id: string; email: string } | null } = { user: null };
vi.mock("@/lib/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config")>()),
  getDataBackend: () => "supabase" as const,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () =>
        authState.user
          ? {
              data: { user: { ...authState.user, user_metadata: { full_name: "新規 ユーザー" } } },
              error: null,
            }
          : { data: { user: null }, error: new Error("no session") },
    },
  }),
}));

const { createMemoryRepository, SEED_USER_IDS } = await import("@/lib/repo/memory");
let repo = createMemoryRepository(true, { persist: false });
vi.mock("@/lib/repo", () => ({ getRepo: async () => repo }));

const { ApiError } = await import("@/lib/api/errors");
const { PROFILE_REQUIRED_REASON, requireProfile, requireUser } = await import("./server");

const NEW_USER_ID = "b0000000-0000-4000-8000-00000000beef";

beforeEach(() => {
  repo = createMemoryRepository(true, { persist: false });
  authState.user = null;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("requireProfile", () => {
  it("未ログインは 401", async () => {
    await expect(requireProfile()).rejects.toMatchObject({ status: 401, code: "UNAUTHORIZED" });
  });

  it("プロフィール未作成（/welcome 未完了）は 403 で details.reason = profile_required", async () => {
    authState.user = { id: NEW_USER_ID, email: "new@example.com" };
    const user = await requireUser();
    expect(user.profile).toBeNull();
    const err = await requireProfile().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 403,
      code: "FORBIDDEN",
      details: { reason: PROFILE_REQUIRED_REASON },
    });
  });

  it("プロフィールがあればユーザーを返す", async () => {
    authState.user = { id: SEED_USER_IDS.userA, email: "a@example.com" };
    const user = await requireProfile();
    expect(user.id).toBe(SEED_USER_IDS.userA);
    expect(user.profile.id).toBe(SEED_USER_IDS.userA);
  });
});

describe("書き込み API はプロフィール未作成なら 403、/me 系は使える", () => {
  const BASE = "http://localhost:3000/api/v1";
  const ctx = { params: Promise.resolve({}) };
  const jsonReq = (path: string, method: string, body: unknown) =>
    new NextRequest(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("POST /lists は 403（profile_required）で、リストは作られない", async () => {
    authState.user = { id: NEW_USER_ID, email: "new@example.com" };
    const { POST } = await import("@/app/api/v1/lists/route");
    const res = await POST(jsonReq("/lists", "POST", { name: "京都" }), ctx);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.details).toEqual({ reason: "profile_required" });
    expect(await repo.wishlists.listByUser(NEW_USER_ID)).toEqual([]);
  });

  it("POST /uploads と PUT /posts/{postId}/like も 403", async () => {
    authState.user = { id: NEW_USER_ID, email: "new@example.com" };
    const { POST: uploads } = await import("@/app/api/v1/uploads/route");
    const up = await uploads(
      jsonReq("/uploads", "POST", { files: [{ kind: "full", contentType: "image/webp", size: 1 }] }),
      ctx,
    );
    expect(up.status).toBe(403);
    const { PUT: like } = await import("@/app/api/v1/posts/[postId]/like/route");
    const postId = "b0000000-0000-4000-8000-000000000001";
    const liked = await like(new NextRequest(`${BASE}/posts/${postId}/like`, { method: "PUT" }), {
      params: Promise.resolve({ postId }),
    });
    expect(liked.status).toBe(403);
  });

  it("GET /me はプロフィール null で 200、POST /me/profile で作成すると書き込みが通る", async () => {
    authState.user = { id: NEW_USER_ID, email: "new@example.com" };
    const { GET: getMe } = await import("@/app/api/v1/me/route");
    const me = await getMe(new NextRequest(`${BASE}/me`, { method: "GET" }), ctx);
    expect(me.status).toBe(200);
    expect((await me.json()).profile).toBeNull();

    const { POST: postProfile } = await import("@/app/api/v1/me/profile/route");
    const created = await postProfile(jsonReq("/me/profile", "POST", { displayName: "新規さん" }), ctx);
    expect(created.status).toBe(201);

    const { POST: postList } = await import("@/app/api/v1/lists/route");
    const res = await postList(jsonReq("/lists", "POST", { name: "京都" }), ctx);
    expect(res.status).toBe(201);
  });
});
