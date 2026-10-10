/**
 * 通報の service を Memory Repository（seed あり）で検証する。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { ApiError } = await import("@/lib/api/errors");
const { LIMITS } = await import("@/lib/domain/constants");
const { createMemoryRepository, SEED_USER_IDS } = await import("@/lib/repo/memory");
const { newId } = await import("@/lib/utils/id");
const { listOpenReports, reportPost } = await import("./reports");

type Repo = ReturnType<typeof createMemoryRepository>;

function makeRepo(): Repo {
  return createMemoryRepository(true, { persist: false });
}

async function firstPostOf(repo: Repo, userId: string) {
  const page = await repo.posts.listByUser(userId, { limit: 1 }, userId);
  expect(page.items.length).toBe(1);
  return page.items[0];
}

async function expectApiError(p: Promise<unknown>, status: number) {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    expect((err as InstanceType<typeof ApiError>).status).toBe(status);
    return err as InstanceType<typeof ApiError>;
  }
  throw new Error(`expected ApiError ${status}`);
}

describe("reportPost", () => {
  it("通報が 3 件で hidden になり、スポットの投稿数が減る", async () => {
    const repo = makeRepo();
    const post = await firstPostOf(repo, SEED_USER_IDS.userA);
    const before = (await repo.spots.getById(post.spotId))!.postCount;
    const third = await repo.profiles.create({ id: newId(), displayName: "通報者C" });
    const reporters = [SEED_USER_IDS.userB, SEED_USER_IDS.admin, third.id];
    expect(reporters.length).toBe(LIMITS.reportAutoHideCount);

    const r1 = await reportPost(repo, reporters[0], post.id, { reason: "spam" });
    expect(r1).toEqual({ count: 1, hidden: false });
    const r2 = await reportPost(repo, reporters[1], post.id, {
      reason: "wrong_place",
      note: "場所が違います",
    });
    expect(r2).toEqual({ count: 2, hidden: false });
    expect((await repo.posts.getById(post.id, null))!.status).toBe("public");

    const r3 = await reportPost(repo, reporters[2], post.id, { reason: "other", note: "" });
    expect(r3).toEqual({ count: 3, hidden: true });
    expect(await repo.posts.getById(post.id, null)).toBeNull();
    expect((await repo.posts.getById(post.id, SEED_USER_IDS.userA))!.status).toBe("hidden");
    expect((await repo.spots.getById(post.spotId))!.postCount).toBe(before - 1);

    // 未処理の通報一覧に 3 件とも載り、post が付く
    const page = await listOpenReports(repo, { limit: 50 });
    const mine = page.items.filter((r) => r.postId === post.id);
    expect(mine).toHaveLength(3);
    expect(mine.every((r) => r.post?.id === post.id && r.post.status === "hidden")).toBe(true);
    expect(mine.find((r) => r.reporterId === reporters[1])?.note).toBe("場所が違います");
    expect(mine.find((r) => r.reporterId === reporters[2])?.note).toBeNull();
  });

  it("自分の投稿は 403", async () => {
    const repo = makeRepo();
    const post = await firstPostOf(repo, SEED_USER_IDS.userA);
    const err = await expectApiError(reportPost(repo, SEED_USER_IDS.userA, post.id, { reason: "spam" }), 403);
    expect(err.code).toBe("FORBIDDEN");
  });

  it("同じ投稿への二重通報は 409、存在しない投稿は 404", async () => {
    const repo = makeRepo();
    const post = await firstPostOf(repo, SEED_USER_IDS.userA);
    await reportPost(repo, SEED_USER_IDS.userB, post.id, { reason: "spam" });
    const err = await expectApiError(
      reportPost(repo, SEED_USER_IDS.userB, post.id, { reason: "other" }),
      409,
    );
    expect(err.code).toBe("CONFLICT");
    await expectApiError(reportPost(repo, SEED_USER_IDS.userB, newId(), { reason: "spam" }), 404);
  });

  it("非表示の投稿は通報できない（404）", async () => {
    const repo = makeRepo();
    const post = await firstPostOf(repo, SEED_USER_IDS.userA);
    await repo.posts.setStatus(post.id, "hidden");
    await expectApiError(reportPost(repo, SEED_USER_IDS.userB, post.id, { reason: "spam" }), 404);
  });
});

describe("listOpenReports", () => {
  it("新しい順でカーソルにより続きが取れる", async () => {
    const repo = makeRepo();
    const posts = await repo.posts.listByUser(SEED_USER_IDS.userA, { limit: 3 }, SEED_USER_IDS.userA);
    expect(posts.items.length).toBe(3);
    for (const p of posts.items) await reportPost(repo, SEED_USER_IDS.userB, p.id, { reason: "spam" });

    const page1 = await listOpenReports(repo, { limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    expect(page1.items[0].createdAt >= page1.items[1].createdAt).toBe(true);
    const page2 = await listOpenReports(repo, { limit: 2, cursor: page1.nextCursor! });
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
    const ids = new Set(page1.items.map((r) => r.id));
    expect(ids.has(page2.items[0].id)).toBe(false);
  });
});
