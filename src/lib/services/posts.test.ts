/**
 * 投稿・いいね・管理の service を Memory Repository（seed あり）で検証する。
 * 外部 API（Nominatim）は fetch をスタブし、ネットワークへ出ない。
 */
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { ApiError } = await import("@/lib/api/errors");
const { resetRateLimits } = await import("@/lib/api/ratelimit");
const { LIMITS, USAGE_LIMITS } = await import("@/lib/domain/constants");
const { resetNominatimThrottleForTests } = await import("@/lib/external/nominatim");
const { suspendThreshold } = await import("@/lib/external/usage");
const { createMemoryRepository, SEED_USER_IDS } = await import("@/lib/repo/memory");
const { newId } = await import("@/lib/utils/id");
const { periodKey } = await import("@/lib/utils/time");
const {
  adminSetPostStatus,
  assertOwnTmpPaths,
  createPost,
  defaultReverseGeocode,
  deletePost,
  likePost,
  tmpPrefixFor,
  unlikePost,
  updatePost,
} = await import("./posts");

type Repo = ReturnType<typeof createMemoryRepository>;

const KYOTO_BBOX = { minLng: 135.6, minLat: 34.85, maxLng: 135.9, maxLat: 35.15 };
const tmpDirs: string[] = [];

async function makeRepo(): Promise<Repo> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "dokoiko-posts-"));
  tmpDirs.push(dir);
  return createMemoryRepository(true, { persist: false, dataDir: dir });
}

/** 一時アップロード済みの写真 1 組（full / thumb）を用意する */
async function uploadedImage(repo: Repo, userId: string) {
  const [full, thumb] = await repo.storage.createSignedUploads(userId, [
    { kind: "full", contentType: "image/webp", size: 1000 },
    { kind: "thumb", contentType: "image/webp", size: 100 },
  ]);
  await repo.writeUploadFile(full.path, new Uint8Array([1, 2, 3]));
  await repo.writeUploadFile(thumb.path, new Uint8Array([4, 5]));
  return { fullPath: full.path, thumbPath: thumb.path, width: 1600, height: 1200 };
}

async function anySpot(repo: Repo) {
  const spots = await repo.spots.inBbox({ bbox: KYOTO_BBOX, limit: 5 });
  expect(spots.length).toBeGreaterThan(0);
  return spots[0];
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

const noGeocode = { reverseGeocode: async () => null };

beforeEach(() => {
  resetRateLimits();
  resetNominatimThrottleForTests();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const d of tmpDirs.splice(0)) await fsp.rm(d, { recursive: true, force: true });
});

describe("assertOwnTmpPaths", () => {
  it("自分の tmp 配下だけ受け付け、他人や確定済み・不正なパスは 400", () => {
    const me = SEED_USER_IDS.userA;
    const ok = {
      fullPath: `${tmpPrefixFor(me)}a.webp`,
      thumbPath: `${tmpPrefixFor(me)}a_t.webp`,
      width: 1,
      height: 1,
    };
    expect(() => assertOwnTmpPaths(me, [ok])).not.toThrow();
    const other = { ...ok, fullPath: `${tmpPrefixFor(SEED_USER_IDS.userB)}a.webp` };
    expect(() => assertOwnTmpPaths(me, [other])).toThrow(ApiError);
    const traversal = { ...ok, thumbPath: `${tmpPrefixFor(me)}../x.webp` };
    expect(() => assertOwnTmpPaths(me, [traversal])).toThrow(ApiError);
    const finalized = { ...ok, fullPath: "posts/abc/a.webp" };
    expect(() => assertOwnTmpPaths(me, [finalized])).toThrow(ApiError);
  });
});

describe("createPost", () => {
  it("既存スポットへの投稿で postCount が増え、画像が確定パスになる", async () => {
    const repo = await makeRepo();
    const me = SEED_USER_IDS.userA;
    const spot = await anySpot(repo);
    const before = (await repo.spots.getById(spot.id))!.postCount;
    const image = await uploadedImage(repo, me);

    const { post, spotId } = await createPost(
      repo,
      me,
      { spotId: spot.id, images: [image], comment: "朝が静か", category: "history", stayDuration: "lt60" },
      noGeocode,
    );
    expect(spotId).toBe(spot.id);
    expect(post.userId).toBe(me);
    expect(post.status).toBe("public");
    expect(post.images).toHaveLength(1);
    expect(post.images[0].fullUrl).toContain(`posts/${post.id}/`);
    expect(post.images[0].fullUrl).not.toContain("posts/tmp/");
    expect(post.likedByMe).toBe(false);
    const after = (await repo.spots.getById(spot.id))!.postCount;
    expect(after).toBe(before + 1);
    // 一時ファイルは移動済み
    expect(await repo.readUploadFile(image.fullPath)).toBeNull();
  });

  it("他人の tmp パスは 400 で、投稿は作られない", async () => {
    const repo = await makeRepo();
    const me = SEED_USER_IDS.userA;
    const spot = await anySpot(repo);
    const other = await uploadedImage(repo, SEED_USER_IDS.userB);
    const countBefore = (await repo.posts.listByUser(me, { limit: 50 }, me)).items.length;
    const err = await expectApiError(
      createPost(
        repo,
        me,
        { spotId: spot.id, images: [other], comment: "", category: "other", stayDuration: null },
        noGeocode,
      ),
      400,
    );
    expect(err.code).toBe("VALIDATION_ERROR");
    expect((await repo.posts.listByUser(me, { limit: 50 }, me)).items.length).toBe(countBefore);
  });

  it("存在しないスポットは 404", async () => {
    const repo = await makeRepo();
    const me = SEED_USER_IDS.userA;
    const image = await uploadedImage(repo, me);
    await expectApiError(
      createPost(
        repo,
        me,
        { spotId: newId(), images: [image], comment: "", category: "other", stayDuration: null },
        noGeocode,
      ),
      404,
    );
  });

  it("アップロードが完了していない画像は 400 で、投稿を残さない", async () => {
    const repo = await makeRepo();
    const me = SEED_USER_IDS.userA;
    const spot = await anySpot(repo);
    const before = (await repo.spots.getById(spot.id))!.postCount;
    const missing = {
      fullPath: `${tmpPrefixFor(me)}none.webp`,
      thumbPath: `${tmpPrefixFor(me)}none_t.webp`,
      width: 10,
      height: 10,
    };
    await expectApiError(
      createPost(
        repo,
        me,
        { spotId: spot.id, images: [missing], comment: "", category: "other", stayDuration: null },
        noGeocode,
      ),
      400,
    );
    expect((await repo.spots.getById(spot.id))!.postCount).toBe(before);
  });

  it("newSpot：50m 内に似た名前があれば 409 と候補", async () => {
    const repo = await makeRepo();
    const me = SEED_USER_IDS.userA;
    const spot = await anySpot(repo);
    const image = await uploadedImage(repo, me);
    const err = await expectApiError(
      createPost(
        repo,
        me,
        {
          newSpot: {
            name: ` ${spot.name} `,
            lat: spot.lat + 0.0001,
            lng: spot.lng,
            source: "gps",
            accuracyM: 10,
          },
          images: [image],
          comment: "",
          category: spot.category,
          stayDuration: null,
        },
        noGeocode,
      ),
      409,
    );
    expect(err.code).toBe("CONFLICT");
    const details = err.details as { candidates: { id: string }[] };
    expect(details.candidates.map((c) => c.id)).toContain(spot.id);
  });

  it("newSpot（gps、address 未指定）：逆ジオコーディングで住所を補い、投稿のカテゴリでスポットを作る", async () => {
    const repo = await makeRepo();
    const me = SEED_USER_IDS.userB;
    const image = await uploadedImage(repo, me);
    const reverseGeocode = vi.fn(async () => ({
      address: "京都府京都市左京区",
      prefecture: "京都府",
      city: "京都市左京区",
    }));
    const { post, spotId } = await createPost(
      repo,
      me,
      {
        newSpot: { name: "テスト用の新しい場所", lat: 35.0302, lng: 135.7726, source: "gps", accuracyM: 12 },
        images: [image],
        comment: "飛び石",
        category: "photogenic",
        stayDuration: "lt30",
      },
      { reverseGeocode },
    );
    expect(reverseGeocode).toHaveBeenCalledTimes(1);
    const spot = await repo.spots.getById(spotId);
    expect(spot).not.toBeNull();
    expect(spot!.name).toBe("テスト用の新しい場所");
    expect(spot!.category).toBe("photogenic");
    expect(spot!.address).toBe("京都府京都市左京区");
    expect(spot!.prefecture).toBe("京都府");
    expect(spot!.city).toBe("京都市左京区");
    expect(spot!.postCount).toBe(1);
    expect(post.spotId).toBe(spotId);
    expect(post.spotName).toBe("テスト用の新しい場所");
  });

  it("newSpot（search_external、address 指定あり）：逆ジオコーディングを呼ばない", async () => {
    const repo = await makeRepo();
    const me = SEED_USER_IDS.userB;
    const image = await uploadedImage(repo, me);
    const reverseGeocode = vi.fn(async () => null);
    const { spotId } = await createPost(
      repo,
      me,
      {
        newSpot: {
          name: "外部検索で見つけた場所",
          lat: 35.01,
          lng: 135.76,
          source: "search_external",
          externalRef: "node:1",
          address: "京都府京都市",
          prefecture: "京都府",
          city: "京都市",
        },
        images: [image],
        comment: "",
        category: "gourmet",
        stayDuration: null,
      },
      { reverseGeocode },
    );
    expect(reverseGeocode).not.toHaveBeenCalled();
    const spot = await repo.spots.getById(spotId);
    expect(spot!.address).toBe("京都府京都市");
  });

  it("停止中（post_create）は 503 で details.feature を返す", async () => {
    const repo = await makeRepo();
    const me = SEED_USER_IDS.userA;
    const spot = await anySpot(repo);
    const image = await uploadedImage(repo, me);
    const { provider, feature, limit } = USAGE_LIMITS.supabase_storage;
    const period = periodKey("month");
    await repo.apiUsage.set(provider, feature, period, limit, limit);
    await repo.apiUsage.setSuspended(provider, feature, period, "2026-10-10T00:00:00.000+09:00");
    const err = await expectApiError(
      createPost(
        repo,
        me,
        { spotId: spot.id, images: [image], comment: "", category: "other", stayDuration: null },
        noGeocode,
      ),
      503,
    );
    expect(err.code).toBe("FEATURE_SUSPENDED");
    expect(err.details).toEqual({ feature: "post_create" });
  });

  it("レート制限：6 件目で 429。DB の件数でも制限する", async () => {
    const repo = await makeRepo();
    const me = SEED_USER_IDS.admin;
    const spot = await anySpot(repo);
    for (let i = 0; i < LIMITS.postsPerMinute; i++) {
      const image = await uploadedImage(repo, me);
      await createPost(
        repo,
        me,
        { spotId: spot.id, images: [image], comment: `${i}`, category: "other", stayDuration: null },
        noGeocode,
      );
    }
    const sixth = await uploadedImage(repo, me);
    const err = await expectApiError(
      createPost(
        repo,
        me,
        { spotId: spot.id, images: [sixth], comment: "", category: "other", stayDuration: null },
        noGeocode,
      ),
      429,
    );
    expect(err.code).toBe("RATE_LIMITED");
    // プロセス内のカウンタを消しても、直近 1 分の投稿数（DB）で 429
    resetRateLimits();
    await expectApiError(
      createPost(
        repo,
        me,
        { spotId: spot.id, images: [sixth], comment: "", category: "other", stayDuration: null },
        noGeocode,
      ),
      429,
    );
    // 別ユーザーは影響を受けない
    const otherImage = await uploadedImage(repo, SEED_USER_IDS.userA);
    const { post } = await createPost(
      repo,
      SEED_USER_IDS.userA,
      { spotId: spot.id, images: [otherImage], comment: "", category: "other", stayDuration: null },
      noGeocode,
    );
    expect(post.userId).toBe(SEED_USER_IDS.userA);
  });

  it("レート制限：投稿が作られなかった試行（409）は数えず、そのあとの正常な投稿は通る", async () => {
    const repo = await makeRepo();
    const me = SEED_USER_IDS.admin;
    const spot = await anySpot(repo);
    const image = await uploadedImage(repo, me);
    const duplicate = {
      newSpot: { name: spot.name, lat: spot.lat, lng: spot.lng, source: "gps" as const, accuracyM: 10 },
      images: [image],
      comment: "",
      category: spot.category,
      stayDuration: null,
    };
    for (let i = 0; i < LIMITS.postsPerMinute + 1; i++) {
      await expectApiError(createPost(repo, me, duplicate, noGeocode), 409);
    }
    const { post } = await createPost(
      repo,
      me,
      { spotId: spot.id, images: [image], comment: "", category: "other", stayDuration: null },
      noGeocode,
    );
    expect(post.userId).toBe(me);
  });
});

describe("defaultReverseGeocode", () => {
  it("Nominatim を 1 回数えて住所を返し、失敗や停止中は null にする", async () => {
    const repo = await makeRepo();
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            place_id: 1,
            osm_type: "way",
            osm_id: 1,
            lat: "35.03",
            lon: "135.77",
            name: "鴨川デルタ",
            display_name: "鴨川デルタ, 左京区, 京都市, 京都府, 日本",
            address: { state: "京都府", city: "京都市", city_district: "左京区" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const geo = await defaultReverseGeocode(repo, 35.03, 135.77);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(geo).toEqual({
      address: "鴨川デルタ, 左京区, 京都市, 京都府, 日本",
      prefecture: "京都府",
      city: "京都市左京区",
    });
    const { provider, feature } = USAGE_LIMITS.nominatim;
    const usage = await repo.apiUsage.get(provider, feature, periodKey("day"));
    expect(usage?.count).toBe(1);

    // 失敗は null
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    resetNominatimThrottleForTests();
    expect(await defaultReverseGeocode(repo, 35.03, 135.77)).toBeNull();

    // 停止中は呼ばずに null
    const { limit } = USAGE_LIMITS.nominatim;
    await repo.apiUsage.set(provider, feature, periodKey("day"), suspendThreshold(limit), limit);
    await repo.apiUsage.setSuspended(provider, feature, periodKey("day"), "2026-10-10T00:00:00.000+09:00");
    const calls = fetchMock.mock.calls.length;
    resetNominatimThrottleForTests();
    expect(await defaultReverseGeocode(repo, 35.03, 135.77)).toBeNull();
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("NOMINATIM_ENABLED=false なら fetch を呼ばない", async () => {
    const repo = await makeRepo();
    vi.stubEnv("NOMINATIM_ENABLED", "false");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await defaultReverseGeocode(repo, 35.03, 135.77)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("updatePost", () => {
  it("本人はコメント・カテゴリ・滞在時間を変更でき、統計が更新される", async () => {
    const repo = await makeRepo();
    const me = SEED_USER_IDS.userA;
    const post = await firstPostOf(repo, me);
    const updated = await updatePost(repo, me, post.id, {
      comment: "更新しました",
      category: "nature",
      stayDuration: "half_day",
    });
    expect(updated.id).toBe(post.id);
    expect(updated.comment).toBe("更新しました");
    expect(updated.category).toBe("nature");
    expect(updated.stayDuration).toBe("half_day");
    expect(updated.updatedAt >= post.updatedAt).toBe(true);
  });

  it("他人の投稿は 403、存在しない投稿は 404", async () => {
    const repo = await makeRepo();
    const post = await firstPostOf(repo, SEED_USER_IDS.userA);
    await expectApiError(updatePost(repo, SEED_USER_IDS.userB, post.id, { comment: "x" }), 403);
    await expectApiError(updatePost(repo, SEED_USER_IDS.userB, newId(), { comment: "x" }), 404);
  });

  it("非表示になった投稿は本人でも編集できない（403）", async () => {
    const repo = await makeRepo();
    const me = SEED_USER_IDS.userA;
    const post = await firstPostOf(repo, me);
    await repo.posts.setStatus(post.id, "hidden");
    const err = await expectApiError(updatePost(repo, me, post.id, { comment: "x" }), 403);
    expect(err.code).toBe("FORBIDDEN");
    expect((await repo.posts.getById(post.id, me))!.comment).toBe(post.comment);
  });

  it("images：自分の新しい tmp パスを確定して置き換え、確定済みパスは残す。他人のパスは 400", async () => {
    const repo = await makeRepo();
    const me = SEED_USER_IDS.userB;
    const spot = await anySpot(repo);
    const first = await uploadedImage(repo, me);
    const { post } = await createPost(
      repo,
      me,
      { spotId: spot.id, images: [first], comment: "", category: "other", stayDuration: null },
      noGeocode,
    );
    const keptFull = `posts/${post.id}/${path.basename(first.fullPath)}`;
    const keptThumb = `posts/${post.id}/${path.basename(first.thumbPath)}`;
    expect(await repo.readUploadFile(keptFull)).not.toBeNull();

    const second = await uploadedImage(repo, me);
    const updated = await updatePost(repo, me, post.id, {
      images: [{ fullPath: keptFull, thumbPath: keptThumb, width: 1600, height: 1200 }, second],
    });
    expect(updated.images).toHaveLength(2);
    expect(updated.images.map((i) => i.sortOrder)).toEqual([0, 1]);
    expect(updated.images.every((i) => i.fullUrl.includes(`posts/${post.id}/`))).toBe(true);
    expect(await repo.readUploadFile(second.fullPath)).toBeNull();
    expect(await repo.readUploadFile(keptFull)).not.toBeNull();

    const other = await uploadedImage(repo, SEED_USER_IDS.userA);
    await expectApiError(updatePost(repo, me, post.id, { images: [other] }), 400);
    const foreignFinalized = {
      fullPath: "posts/other-post/a.webp",
      thumbPath: "posts/other-post/a_t.webp",
      width: 1,
      height: 1,
    };
    await expectApiError(updatePost(repo, me, post.id, { images: [foreignFinalized] }), 400);
  });

  it("images：古い画像のパスが PostView にあれば Storage から削除する", async () => {
    const repo = await makeRepo();
    const me = SEED_USER_IDS.userB;
    const post = await firstPostOf(repo, me);
    const oldPaths = ["posts/old/x.webp", "posts/old/x_t.webp"];
    vi.spyOn(repo.posts, "getById").mockImplementationOnce(async () => ({
      ...post,
      images: [{ ...post.images[0], fullPath: oldPaths[0], thumbPath: oldPaths[1] }],
    }));
    const deleteObjects = vi.spyOn(repo.storage, "deleteObjects");
    const fresh = await uploadedImage(repo, me);
    await updatePost(repo, me, post.id, { images: [fresh] });
    expect(deleteObjects).toHaveBeenCalledTimes(1);
    expect(deleteObjects.mock.calls[0][0]).toEqual(oldPaths);
  });
});

describe("deletePost", () => {
  it("本人の削除で画像パスが Storage から消え、スポットの統計が減る", async () => {
    const repo = await makeRepo();
    const me = SEED_USER_IDS.userA;
    const spot = await anySpot(repo);
    const image = await uploadedImage(repo, me);
    const { post } = await createPost(
      repo,
      me,
      { spotId: spot.id, images: [image], comment: "", category: "other", stayDuration: null },
      noGeocode,
    );
    const before = (await repo.spots.getById(spot.id))!.postCount;
    const deleteObjects = vi.spyOn(repo.storage, "deleteObjects");

    await deletePost(repo, { id: me, isAdmin: false }, post.id);

    expect(await repo.posts.getById(post.id, me)).toBeNull();
    expect((await repo.spots.getById(spot.id))!.postCount).toBe(before - 1);
    expect(deleteObjects).toHaveBeenCalledTimes(1);
    const paths = deleteObjects.mock.calls[0][0];
    expect(paths).toHaveLength(2);
    expect(paths.every((p) => p.startsWith(`posts/${post.id}/`))).toBe(true);
    expect(await repo.readUploadFile(paths[0])).toBeNull();
  });

  it("他人は 403、管理者は削除できる、存在しなければ 404", async () => {
    const repo = await makeRepo();
    const post = await firstPostOf(repo, SEED_USER_IDS.userA);
    await expectApiError(deletePost(repo, { id: SEED_USER_IDS.userB, isAdmin: false }, post.id), 403);
    await deletePost(repo, { id: SEED_USER_IDS.admin, isAdmin: true }, post.id);
    expect(await repo.posts.getById(post.id, SEED_USER_IDS.userA)).toBeNull();
    await expectApiError(deletePost(repo, { id: SEED_USER_IDS.userA, isAdmin: false }, post.id), 404);
  });

  it("画像の削除に失敗しても投稿の削除は成功する", async () => {
    const repo = await makeRepo();
    const me = SEED_USER_IDS.userA;
    const post = await firstPostOf(repo, me);
    vi.spyOn(repo.storage, "deleteObjects").mockRejectedValueOnce(new Error("storage down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await deletePost(repo, { id: me, isAdmin: false }, post.id);
    expect(await repo.posts.getById(post.id, me)).toBeNull();
  });
});

describe("likePost / unlikePost", () => {
  it("いいねは冪等で、取り消しも冪等。スポットの likeCount に反映される", async () => {
    const repo = await makeRepo();
    const post = await firstPostOf(repo, SEED_USER_IDS.userA);
    const me = SEED_USER_IDS.userB;
    // 既にいいね済みかもしれないので、まず取り消して基準を作る
    const { likeCount: base } = await unlikePost(repo, me, post.id);
    const spotBefore = (await repo.spots.getById(post.spotId))!.likeCount;

    expect((await likePost(repo, me, post.id)).likeCount).toBe(base + 1);
    expect((await likePost(repo, me, post.id)).likeCount).toBe(base + 1);
    expect((await repo.posts.getById(post.id, me))!.likedByMe).toBe(true);
    expect((await repo.spots.getById(post.spotId))!.likeCount).toBe(spotBefore + 1);

    expect((await unlikePost(repo, me, post.id)).likeCount).toBe(base);
    expect((await unlikePost(repo, me, post.id)).likeCount).toBe(base);
    expect((await repo.posts.getById(post.id, me))!.likedByMe).toBe(false);
    expect((await repo.spots.getById(post.spotId))!.likeCount).toBe(spotBefore);
  });

  it("存在しない投稿・非表示の投稿は 404", async () => {
    const repo = await makeRepo();
    await expectApiError(likePost(repo, SEED_USER_IDS.userB, newId()), 404);
    const post = await firstPostOf(repo, SEED_USER_IDS.userA);
    await repo.posts.setStatus(post.id, "hidden");
    await expectApiError(likePost(repo, SEED_USER_IDS.userB, post.id), 404);
  });
});

describe("adminSetPostStatus", () => {
  it("非表示でスポットの投稿数が減って通報が解決済みになり、再表示で投稿数が戻る", async () => {
    const repo = await makeRepo();
    const admin = SEED_USER_IDS.admin;
    const post = await firstPostOf(repo, SEED_USER_IDS.userA);
    const before = (await repo.spots.getById(post.spotId))!.postCount;
    await repo.reports.create({
      postId: post.id,
      reporterId: SEED_USER_IDS.userB,
      reason: "spam",
      note: null,
    });

    const hidden = await adminSetPostStatus(repo, admin, post.id, "hidden");
    expect(hidden.status).toBe("hidden");
    expect((await repo.spots.getById(post.spotId))!.postCount).toBe(before - 1);
    expect(await repo.posts.getById(post.id, null)).toBeNull();
    // 管理者が確認して非表示にした時点で、通報は未処理一覧から消える（F-7-3）
    expect((await repo.reports.listOpen({ limit: 50 })).items.some((r) => r.postId === post.id)).toBe(false);

    await repo.reports.create({
      postId: post.id,
      reporterId: SEED_USER_IDS.admin,
      reason: "other",
      note: null,
    });
    const shown = await adminSetPostStatus(repo, admin, post.id, "public");
    expect(shown.status).toBe("public");
    expect((await repo.spots.getById(post.spotId))!.postCount).toBe(before);
    expect((await repo.reports.listOpen({ limit: 50 })).items.some((r) => r.postId === post.id)).toBe(false);
  });

  it("存在しない投稿は 404", async () => {
    const repo = await makeRepo();
    await expectApiError(adminSetPostStatus(repo, SEED_USER_IDS.admin, newId(), "hidden"), 404);
  });
});
