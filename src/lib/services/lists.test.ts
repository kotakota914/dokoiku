/**
 * 行きたい場所リスト API の service と Route Handler のテスト（memory モード、seed あり）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { LIMITS } from "@/lib/domain/constants";
import type { LatLng, Wishlist } from "@/lib/domain/types";
import { createMemoryRepository, SEED_USER_IDS } from "@/lib/repo/memory";
import type { Repository, WishlistsRepo } from "@/lib/repo/types";
import {
  ALREADY_ADDED_MESSAGE,
  ITEMS_LIMIT_MESSAGE,
  LISTS_LIMIT_MESSAGE,
  SHARED_NOT_FOUND_MESSAGE,
  addWishlistItem,
  createWishlist,
  deleteWishlist,
  getOwnedWishlist,
  getSharedWishlist,
  listWishlists,
  removeWishlistItem,
  renameWishlist,
  setWishlistItemMustVisit,
  shareWishlist,
  sharedListUrl,
  unshareWishlist,
  updateWishlist,
} from "./lists";

vi.mock("server-only", () => ({}));

type BaseInput = { label: string; location: LatLng } | null;

/**
 * v0.3 F-4-8 の拠点。`WishlistsRepo.setBase` は data 担当が実装中なので、
 * ここでは Repository の契約どおりに振る舞うモック（保存した拠点を getById にも反映する）で差し替える。
 */
function withBase(base: Repository): Repository & { setBase: ReturnType<typeof vi.fn> } {
  const bases = new Map<string, BaseInput>();
  const applyBase = <T extends Wishlist>(list: T): T => {
    const b = bases.get(list.id);
    if (b === undefined) return list;
    return { ...list, baseLabel: b?.label ?? null, baseLocation: b?.location ?? null };
  };
  const setBase = vi.fn(async (id: string, input: BaseInput): Promise<Wishlist> => {
    const list = await base.wishlists.getById(id);
    if (!list) throw new Error(`wishlist not found: ${id}`);
    bases.set(id, input);
    const { items, plans, ...rest } = applyBase(list);
    void items;
    void plans;
    return rest;
  });
  const wishlists: WishlistsRepo = {
    ...base.wishlists,
    setBase,
    getById: async (id) => {
      const list = await base.wishlists.getById(id);
      return list ? applyBase(list) : null;
    },
    rename: async (id, name) => applyBase(await base.wishlists.rename(id, name)),
  };
  return { ...base, wishlists, setBase };
}

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
  requireProfile: async () => {
    if (!authState.userId) {
      const { ApiError } = await import("@/lib/api/errors");
      throw ApiError.unauthorized();
    }
    return { id: authState.userId, isAdmin: false };
  },
}));
let repo: Repository = createMemoryRepository(true, { persist: false });
vi.mock("@/lib/repo", () => ({ getRepo: async () => repo }));

const USER_A = SEED_USER_IDS.userA;
const USER_B = SEED_USER_IDS.userB;
const UNKNOWN_ID = "b0000000-0000-4000-8000-ffffffffffff";

/** seed のスポット ID を投稿数の多い順に取る */
async function seedSpotIds(limit = 50): Promise<string[]> {
  const page = await repo.spots.search({ sort: "popular", paging: { limit } });
  return page.items.map((s) => s.id);
}

async function expectApiError(p: Promise<unknown>, status: number, message?: string): Promise<ApiError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    const e = err as ApiError;
    expect(e.status).toBe(status);
    if (message) expect(e.message).toBe(message);
    return e;
  }
  throw new Error(`expected ApiError ${status} but resolved`);
}

beforeEach(() => {
  repo = createMemoryRepository(true, { persist: false });
  authState.userId = null;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("リストの作成・一覧・名前変更・削除（F-4-1）", () => {
  it("作成したリストが一覧に出て、名前変更と削除ができる", async () => {
    const list = await createWishlist(repo, USER_A, { name: "金沢1日目" });
    expect(list).toMatchObject({ userId: USER_A, name: "金沢1日目", shareToken: null, itemCount: 0 });
    expect((await listWishlists(repo, USER_A)).lists.map((l) => l.id)).toEqual([list.id]);
    expect((await listWishlists(repo, USER_B)).lists).toEqual([]);

    const renamed = await renameWishlist(repo, USER_A, list.id, { name: "金沢2日目" });
    expect(renamed.name).toBe("金沢2日目");
    const detail = await getOwnedWishlist(repo, USER_A, list.id);
    expect(detail).toMatchObject({ id: list.id, name: "金沢2日目", items: [], plans: [] });

    await deleteWishlist(repo, USER_A, list.id);
    await expectApiError(getOwnedWishlist(repo, USER_A, list.id), 404);
  });

  it("一覧は新しい順（作成したリストが先頭。memory と supabase で同じ並び。S-06 / F4-3）", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-10T01:00:00Z") });
    try {
      const first = await createWishlist(repo, USER_A, { name: "1つ目" });
      vi.setSystemTime(new Date("2026-10-10T01:00:01Z"));
      const second = await createWishlist(repo, USER_A, { name: "2つ目" });
      vi.setSystemTime(new Date("2026-10-10T01:00:02Z"));
      const third = await createWishlist(repo, USER_A, { name: "3つ目" });
      expect((await listWishlists(repo, USER_A)).lists.map((l) => l.id)).toEqual([
        third.id,
        second.id,
        first.id,
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("21 件目のリストは 409", async () => {
    for (let i = 0; i < LIMITS.listsPerUser; i += 1)
      await createWishlist(repo, USER_A, { name: `リスト${i + 1}` });
    const err = await expectApiError(
      createWishlist(repo, USER_A, { name: "もう1つ" }),
      409,
      LISTS_LIMIT_MESSAGE,
    );
    expect(err.code).toBe("CONFLICT");
    // 他のユーザーには影響しない
    await expect(createWishlist(repo, USER_B, { name: "Bのリスト" })).resolves.toMatchObject({
      userId: USER_B,
    });
  });

  it("他人のリストは 403、存在しないリストは 404", async () => {
    const list = await createWishlist(repo, USER_A, { name: "Aのリスト" });
    const [spotId] = await seedSpotIds(1);
    await expectApiError(getOwnedWishlist(repo, USER_B, list.id), 403);
    await expectApiError(renameWishlist(repo, USER_B, list.id, { name: "乗っ取り" }), 403);
    await expectApiError(deleteWishlist(repo, USER_B, list.id), 403);
    await expectApiError(addWishlistItem(repo, USER_B, list.id, { spotId }), 403);
    await expectApiError(shareWishlist(repo, USER_B, list.id), 403);
    await expectApiError(getOwnedWishlist(repo, USER_A, UNKNOWN_ID), 404);
    await expectApiError(renameWishlist(repo, USER_A, UNKNOWN_ID, { name: "x" }), 404);
    await expectApiError(deleteWishlist(repo, USER_A, UNKNOWN_ID), 404);
    // 何も変わっていない
    expect((await getOwnedWishlist(repo, USER_A, list.id)).name).toBe("Aのリスト");
  });
});

describe("スポットの追加・必ず行きたい・削除（F-4-2, F-4-4）", () => {
  it("追加すると itemCount が増え、重複は 409「追加済みです」", async () => {
    const list = await createWishlist(repo, USER_A, { name: "リスト" });
    const [s1, s2] = await seedSpotIds(2);
    expect(await addWishlistItem(repo, USER_A, list.id, { spotId: s1 })).toEqual({ itemCount: 1 });
    expect(await addWishlistItem(repo, USER_A, list.id, { spotId: s2 })).toEqual({ itemCount: 2 });
    await expectApiError(addWishlistItem(repo, USER_A, list.id, { spotId: s1 }), 409, ALREADY_ADDED_MESSAGE);
    const detail = await getOwnedWishlist(repo, USER_A, list.id);
    expect(detail.itemCount).toBe(2);
    expect(detail.items.map((i) => i.spotId)).toEqual([s1, s2]);
    expect(detail.items[0]).toMatchObject({ mustVisit: false, spot: { id: s1, name: expect.any(String) } });
  });

  it("存在しないスポットは 404", async () => {
    const list = await createWishlist(repo, USER_A, { name: "リスト" });
    await expectApiError(addWishlistItem(repo, USER_A, list.id, { spotId: UNKNOWN_ID }), 404);
  });

  it("31 か所目は 409", async () => {
    const list = await createWishlist(repo, USER_A, { name: "リスト" });
    const ids = await seedSpotIds(LIMITS.itemsPerList + 1);
    expect(ids.length).toBeGreaterThan(LIMITS.itemsPerList);
    for (const id of ids.slice(0, LIMITS.itemsPerList))
      await addWishlistItem(repo, USER_A, list.id, { spotId: id });
    await expectApiError(
      addWishlistItem(repo, USER_A, list.id, { spotId: ids[LIMITS.itemsPerList] }),
      409,
      ITEMS_LIMIT_MESSAGE,
    );
    // 上限でも既に入っているスポットは「追加済み」
    await expectApiError(
      addWishlistItem(repo, USER_A, list.id, { spotId: ids[0] }),
      409,
      ALREADY_ADDED_MESSAGE,
    );
    expect((await getOwnedWishlist(repo, USER_A, list.id)).itemCount).toBe(LIMITS.itemsPerList);
  });

  it("必ず行きたいの付け外しと、スポットの削除", async () => {
    const list = await createWishlist(repo, USER_A, { name: "リスト" });
    const [s1] = await seedSpotIds(1);
    await addWishlistItem(repo, USER_A, list.id, { spotId: s1 });
    expect(await setWishlistItemMustVisit(repo, USER_A, list.id, s1, { mustVisit: true })).toEqual({
      mustVisit: true,
    });
    expect((await getOwnedWishlist(repo, USER_A, list.id)).items[0].mustVisit).toBe(true);
    expect(await setWishlistItemMustVisit(repo, USER_A, list.id, s1, { mustVisit: false })).toEqual({
      mustVisit: false,
    });
    await expectApiError(
      setWishlistItemMustVisit(repo, USER_A, list.id, UNKNOWN_ID, { mustVisit: true }),
      404,
    );
    await expectApiError(setWishlistItemMustVisit(repo, USER_B, list.id, s1, { mustVisit: true }), 403);

    await removeWishlistItem(repo, USER_A, list.id, s1);
    expect((await getOwnedWishlist(repo, USER_A, list.id)).itemCount).toBe(0);
    await expectApiError(removeWishlistItem(repo, USER_A, list.id, s1), 404);
  });
});

describe("共有 URL（F-4-6）", () => {
  it("発行したトークンで閲覧でき、再発行は同じトークン、停止すると 404", async () => {
    const list = await createWishlist(repo, USER_A, { name: "共有するリスト" });
    const [s1] = await seedSpotIds(1);
    await addWishlistItem(repo, USER_A, list.id, { spotId: s1 });

    const first = await shareWishlist(repo, USER_A, list.id, "https://example.com/");
    expect(first.shareToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(first.url).toBe(`https://example.com/shared/${first.shareToken}`);
    const second = await shareWishlist(repo, USER_A, list.id, "https://example.com");
    expect(second).toEqual(first);
    expect((await getOwnedWishlist(repo, USER_A, list.id)).shareToken).toBe(first.shareToken);

    const shared = await getSharedWishlist(repo, first.shareToken);
    expect(shared).toMatchObject({ name: "共有するリスト", ownerDisplayName: "開発ユーザーA" });
    expect(shared.items.map((i) => i.spotId)).toEqual([s1]);

    await unshareWishlist(repo, USER_A, list.id);
    expect((await getOwnedWishlist(repo, USER_A, list.id)).shareToken).toBeNull();
    await expectApiError(getSharedWishlist(repo, first.shareToken), 404, SHARED_NOT_FOUND_MESSAGE);
    // 停止は何度でも 204 相当（例外にならない）
    await expect(unshareWishlist(repo, USER_A, list.id)).resolves.toBeUndefined();
  });

  it("不明なトークンは 404、共有 URL は siteUrl を元にする", async () => {
    await expectApiError(getSharedWishlist(repo, "no-such-token"), 404, SHARED_NOT_FOUND_MESSAGE);
    await expectApiError(getSharedWishlist(repo, ""), 404);
    expect(sharedListUrl("abc", "http://localhost:3000")).toBe("http://localhost:3000/shared/abc");
  });
});

describe("Route Handler", () => {
  it("GET /lists は未ログインなら 401、ログイン中は自分のリストを返す", async () => {
    const { GET } = await import("@/app/api/v1/lists/route");
    const ctx = { params: Promise.resolve({}) };
    const res401 = await GET(new NextRequest("http://localhost/api/v1/lists"), ctx);
    expect(res401.status).toBe(401);
    expect(await res401.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });

    authState.userId = USER_A;
    await createWishlist(repo, USER_A, { name: "A" });
    await createWishlist(repo, USER_B, { name: "B" });
    const res = await GET(new NextRequest("http://localhost/api/v1/lists"), ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lists: { name: string }[] };
    expect(body.lists.map((l) => l.name)).toEqual(["A"]);
  });

  it("POST /lists は 201、名前が空なら 400、21 件目は 409", async () => {
    const { POST } = await import("@/app/api/v1/lists/route");
    const ctx = { params: Promise.resolve({}) };
    authState.userId = USER_A;
    const post = (body: unknown) =>
      POST(
        new NextRequest("http://localhost/api/v1/lists", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        ctx,
      );
    const res = await post({ name: "  新しいリスト  " });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ name: "新しいリスト", userId: USER_A, itemCount: 0 });

    const bad = await post({ name: "   " });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    for (let i = 1; i < LIMITS.listsPerUser; i += 1) expect((await post({ name: `L${i}` })).status).toBe(201);
    const over = await post({ name: "over" });
    expect(over.status).toBe(409);
    expect(await over.json()).toMatchObject({ error: { code: "CONFLICT", message: LISTS_LIMIT_MESSAGE } });
  });

  it("共有 API：POST/DELETE /lists/{listId}/share と GET /shared/{token}", async () => {
    const share = await import("@/app/api/v1/lists/[listId]/share/route");
    const shared = await import("@/app/api/v1/shared/[token]/route");
    const list = await createWishlist(repo, USER_A, { name: "共有" });
    const listCtx = { params: Promise.resolve({ listId: list.id }) };

    authState.userId = USER_B;
    expect(
      (await share.POST(new NextRequest("http://localhost/x", { method: "POST" }), listCtx)).status,
    ).toBe(403);

    authState.userId = USER_A;
    const issued = await share.POST(new NextRequest("http://localhost/x", { method: "POST" }), listCtx);
    expect(issued.status).toBe(200);
    const { shareToken, url } = (await issued.json()) as { shareToken: string; url: string };
    expect(url).toContain(`/shared/${shareToken}`);

    authState.userId = null;
    const view = await shared.GET(new NextRequest("http://localhost/x"), {
      params: Promise.resolve({ token: shareToken }),
    });
    expect(view.status).toBe(200);
    expect(await view.json()).toMatchObject({ name: "共有", ownerDisplayName: "開発ユーザーA", items: [] });

    authState.userId = USER_A;
    expect(
      (await share.DELETE(new NextRequest("http://localhost/x", { method: "DELETE" }), listCtx)).status,
    ).toBe(204);
    const gone = await shared.GET(new NextRequest("http://localhost/x"), {
      params: Promise.resolve({ token: shareToken }),
    });
    expect(gone.status).toBe(404);
    expect(await gone.json()).toMatchObject({
      error: { code: "NOT_FOUND", message: SHARED_NOT_FOUND_MESSAGE },
    });
  });
});

const STATION = { label: "金沢駅", location: { lat: 36.578, lng: 136.6478 } };

describe("拠点の設定・変更・解除（v0.3 F-4-8、PATCH /lists/{listId}）", () => {
  it("base を渡すと setBase が呼ばれ、更新後の Wishlist に拠点が入る。null で解除", async () => {
    const r = withBase(repo);
    const list = await createWishlist(r, USER_A, { name: "金沢" });
    expect((await getOwnedWishlist(r, USER_A, list.id)).baseLabel ?? null).toBeNull();

    const set = await updateWishlist(r, USER_A, list.id, { base: STATION });
    expect(r.setBase).toHaveBeenCalledWith(list.id, STATION);
    expect(set).toMatchObject({
      id: list.id,
      name: "金沢",
      baseLabel: "金沢駅",
      baseLocation: STATION.location,
    });
    // GET /lists/{listId} にも反映される
    const detail = await getOwnedWishlist(r, USER_A, list.id);
    expect(detail).toMatchObject({ baseLabel: "金沢駅", baseLocation: STATION.location });

    const changed = await updateWishlist(r, USER_A, list.id, {
      base: { label: "ホテル", location: { lat: 36.57, lng: 136.65 } },
    });
    expect(changed.baseLabel).toBe("ホテル");

    const cleared = await updateWishlist(r, USER_A, list.id, { base: null });
    expect(r.setBase).toHaveBeenLastCalledWith(list.id, null);
    expect(cleared).toMatchObject({ baseLabel: null, baseLocation: null });
  });

  it("name と base を同時に渡すと両方が反映され、name だけなら setBase を呼ばない（互換）", async () => {
    const r = withBase(repo);
    const list = await createWishlist(r, USER_A, { name: "金沢" });
    const both = await updateWishlist(r, USER_A, list.id, { name: "金沢1日目", base: STATION });
    expect(both).toMatchObject({ name: "金沢1日目", baseLabel: "金沢駅" });
    expect(r.setBase).toHaveBeenCalledTimes(1);

    const renamed = await updateWishlist(r, USER_A, list.id, { name: "金沢2日目" });
    expect(renamed).toMatchObject({ name: "金沢2日目", baseLabel: "金沢駅" });
    expect(r.setBase).toHaveBeenCalledTimes(1);
  });

  it("memory Repository の setBase（data 担当の実装）でも設定・名前変更・解除が往復する", async () => {
    const list = await createWishlist(repo, USER_A, { name: "金沢" });
    expect(list).toMatchObject({ baseLabel: null, baseLocation: null });
    expect(await updateWishlist(repo, USER_A, list.id, { name: "金沢1日目", base: STATION })).toMatchObject({
      name: "金沢1日目",
      baseLabel: "金沢駅",
      baseLocation: STATION.location,
    });
    expect(await getOwnedWishlist(repo, USER_A, list.id)).toMatchObject({ baseLabel: "金沢駅" });
    expect((await listWishlists(repo, USER_A)).lists[0]).toMatchObject({ baseLabel: "金沢駅" });
    expect(await updateWishlist(repo, USER_A, list.id, { base: null })).toMatchObject({
      name: "金沢1日目",
      baseLabel: null,
      baseLocation: null,
    });
  });

  it("他人のリストは 403、存在しないリストは 404 で、setBase は呼ばれない", async () => {
    const r = withBase(repo);
    const list = await createWishlist(r, USER_A, { name: "A" });
    await expectApiError(updateWishlist(r, USER_B, list.id, { base: STATION }), 403);
    await expectApiError(updateWishlist(r, USER_A, UNKNOWN_ID, { base: STATION }), 404);
    expect(r.setBase).not.toHaveBeenCalled();
  });

  it("PATCH /lists/{listId}：name / base / null を受け、不正な body は 400。外部 API は呼ばない", async () => {
    const { GET, PATCH } = await import("@/app/api/v1/lists/[listId]/route");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    repo = withBase(repo);
    const list = await createWishlist(repo, USER_A, { name: "金沢" });
    const ctx = { params: Promise.resolve({ listId: list.id }) };
    const patch = (body: unknown) =>
      PATCH(
        new NextRequest(`http://localhost/api/v1/lists/${list.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        ctx,
      );

    expect((await patch({ base: STATION })).status).toBe(401);

    authState.userId = USER_B;
    expect((await patch({ base: STATION })).status).toBe(403);

    authState.userId = USER_A;
    const set = await patch({ base: STATION });
    expect(set.status).toBe(200);
    expect(await set.json()).toMatchObject({
      id: list.id,
      baseLabel: "金沢駅",
      baseLocation: STATION.location,
    });

    const detail = await GET(new NextRequest(`http://localhost/api/v1/lists/${list.id}`), ctx);
    expect(await detail.json()).toMatchObject({ baseLabel: "金沢駅", baseLocation: STATION.location });

    // v0.1 互換：name だけ
    const renamed = await patch({ name: "金沢1日目" });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({ name: "金沢1日目", baseLabel: "金沢駅" });

    const cleared = await patch({ base: null });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ baseLabel: null, baseLocation: null });

    for (const bad of [
      {},
      { base: { label: "", location: STATION.location } },
      { base: { label: "x", location: { lat: 100, lng: 0 } } },
      { base: { label: "x" } },
      { name: "" },
    ]) {
      const res = await patch(bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
