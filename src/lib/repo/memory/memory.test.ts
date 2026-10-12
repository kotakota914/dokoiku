import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LIMITS, STAY_DURATION_MINUTES } from "@/lib/domain/constants";
import { haversineM, normalizeName } from "@/lib/utils/geo";
import { jstHour } from "@/lib/utils/time";
import { buildSeedData, createMemoryRepository, SEED_USER_IDS, type MemoryRepository } from "./index";
import { seedSpotInfo, seedUuid, SPOT_SEEDS, withPhotoCredit } from "./seed";

/** 金沢市・野々市市を含む範囲 */
const KANAZAWA_BBOX = { minLng: 136.55, minLat: 36.48, maxLng: 136.75, maxLat: 36.65 };

const IMG = (n: number) => ({
  fullPath: `seed/test/${n}.svg`,
  thumbPath: `seed/test/${n}_t.svg`,
  width: 1600,
  height: 1200,
  sortOrder: 0,
});

const tmpDirs: string[] = [];
afterEach(async () => {
  for (const d of tmpDirs.splice(0)) await fsp.rm(d, { recursive: true, force: true });
});

async function mkTmp(): Promise<string> {
  const d = await fsp.mkdtemp(path.join(os.tmpdir(), "dokoiko-memory-"));
  tmpDirs.push(d);
  return d;
}

/** createdAt（ミリ秒）が前後するように少し待つ */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 3));
}

function repoWithSeed(): MemoryRepository {
  return createMemoryRepository(true, { persist: false });
}

describe("seed", () => {
  it("決定的で、40件前後のスポットと3人のユーザーを含む", () => {
    const a = buildSeedData();
    const b = buildSeedData();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.profiles).toHaveLength(3);
    expect(a.profiles.filter((p) => p.isAdmin).map((p) => p.id)).toEqual([SEED_USER_IDS.admin]);
    expect(a.spots.length).toBeGreaterThanOrEqual(35);
    expect(a.spots.length).toBeLessThanOrEqual(50);
    expect(a.spots.every((s) => s.postCount >= 1 && s.postCount <= 25)).toBe(true);
    expect(a.spots.filter((s) => s.postCount >= 20).length).toBeGreaterThanOrEqual(2);
    expect(a.spots.filter((s) => s.postCount >= 5 && s.postCount < 20).length).toBeGreaterThanOrEqual(8);
    // 5カテゴリすべてに分散し、投稿は3人に分散、絵文字なし
    expect(new Set(a.spots.map((s) => s.category)).size).toBe(5);
    expect(new Set(a.posts.map((p) => p.userId)).size).toBe(3);
    expect(a.posts.some((p) => /\p{Extended_Pictographic}/u.test(p.comment))).toBe(false);
    expect(a.posts.every((p) => p.createdAt >= "2025-11" && p.createdAt < "2026-10-10")).toBe(true);
    expect(a.likes.length).toBeGreaterThan(0);
    expect(
      a.images.every(
        (i) =>
          i.fullPath.startsWith("seed/") &&
          /_t\.(svg|webp)$/.test(i.thumbPath) &&
          i.width > 0 &&
          i.height > 0,
      ),
    ).toBe(true);
    expect(a.posts.every((p) => [...p.comment].length <= 150)).toBe(true);
    // 金沢工業大学の学内スポットを含む
    expect(a.spots.filter((s) => s.name.startsWith("金沢工業大学")).length).toBeGreaterThanOrEqual(6);
    expect(a.spots.every((s) => s.prefecture === "石川県")).toBe(true);
  });

  it("seed 読み込み後の件数が seed と一致する", async () => {
    const repo = repoWithSeed();
    const data = buildSeedData();
    const spots = await repo.spots.inBbox({ bbox: KANAZAWA_BBOX, limit: 1000 });
    expect(spots).toHaveLength(data.spots.length);
    expect(spots.reduce((s, x) => s + x.postCount, 0)).toBe(data.posts.length);
    const profile = await repo.profiles.getById(SEED_USER_IDS.admin);
    expect(profile?.displayName).toBe("管理者ユーザー");
  });

  it("seedSpotInfo は spots.json の並び順で名前とカテゴリを返す", () => {
    expect(seedSpotInfo(seedUuid("spot", 1))).toEqual({ name: "兼六園", category: "nature" });
    expect(seedSpotInfo(seedUuid("spot", SPOT_SEEDS.length))).toEqual({
      name: SPOT_SEEDS[SPOT_SEEDS.length - 1].name,
      category: SPOT_SEEDS[SPOT_SEEDS.length - 1].category,
    });
    expect(seedSpotInfo(seedUuid("spot", SPOT_SEEDS.length + 1))).toBeNull();
    expect(seedSpotInfo("not-a-seed-id")).toBeNull();
  });

  it("写真付き投稿のコメント末尾にライセンス表示を付け、150 文字以内に収める", () => {
    const credit = withPhotoCredit("朝は静かです", { author: "Taro", license: "CC BY-SA 4.0" });
    expect(credit).toBe("朝は静かです\n写真: Taro（CC BY-SA 4.0）");
    const long = withPhotoCredit("あ".repeat(200), { author: "x".repeat(80), license: "CC BY 2.0" });
    expect([...long].length).toBeLessThanOrEqual(150);
    expect(long.endsWith("（CC BY 2.0）")).toBe(true);
    expect(long).toContain("…");
    expect(withPhotoCredit("", { author: "", license: "" })).toBe("写真: 不明");
  });
});

describe("spots", () => {
  it("inBbox は投稿数の多い順で limit 件に切る", async () => {
    const repo = repoWithSeed();
    const all = await repo.spots.inBbox({ bbox: KANAZAWA_BBOX, limit: 1000 });
    for (let i = 1; i < all.length; i += 1)
      expect(all[i - 1].postCount).toBeGreaterThanOrEqual(all[i].postCount);
    const top5 = await repo.spots.inBbox({ bbox: KANAZAWA_BBOX, limit: 5 });
    expect(top5.map((s) => s.id)).toEqual(all.slice(0, 5).map((s) => s.id));
    expect(top5[0].popularity).toBe("very_popular");
    expect(top5[0].coverThumbUrl).toMatch(/^\/api\/dev\/files\/seed\//);
    // 狭い範囲（兼六園周辺）とカテゴリ絞り込み
    const near = await repo.spots.inBbox({
      bbox: { minLng: 136.655, minLat: 36.555, maxLng: 136.67, maxLat: 36.568 },
      limit: 100,
    });
    expect(near.some((s) => s.name === "兼六園")).toBe(true);
    expect(near.length).toBeLessThan(all.length);
    const gourmet = await repo.spots.inBbox({ bbox: KANAZAWA_BBOX, categories: ["gourmet"], limit: 100 });
    expect(gourmet.length).toBeGreaterThan(0);
    expect(gourmet.every((s) => s.category === "gourmet")).toBe(true);
    const heat = await repo.spots.heatmap({ bbox: KANAZAWA_BBOX, limit: 3 });
    expect(heat).toHaveLength(3);
    expect(heat[0].weight).toBe(all[0].postCount);
  });

  it("nearby は半径内を近い順に返す", async () => {
    const repo = repoWithSeed();
    const center = { lat: 36.5608, lng: 136.6584 }; // 金沢21世紀美術館
    const near = await repo.spots.nearby({ ...center, radiusM: 300, limit: 10 });
    expect(near.length).toBeGreaterThanOrEqual(2);
    expect(near[0].name).toBe("金沢21世紀美術館");
    expect(near[0].distanceM).toBe(0);
    for (let i = 1; i < near.length; i += 1)
      expect(near[i - 1].distanceM).toBeLessThanOrEqual(near[i].distanceM);
    expect(near.every((s) => s.distanceM <= 300)).toBe(true);
    expect(near.every((s) => Math.abs(haversineM(center, s) - s.distanceM) < 1)).toBe(true);
    const tight = await repo.spots.nearby({ ...center, radiusM: 10, limit: 10 });
    expect(tight.map((s) => s.name)).toEqual(["金沢21世紀美術館"]);
    const none = await repo.spots.nearby({ lat: 35.6895, lng: 139.6917, radiusM: 300, limit: 10 });
    expect(none).toEqual([]);
  });

  it("search は keyword（表記ゆれ）・city・category で絞り込み、popular/newest で並ぶ", async () => {
    const repo = repoWithSeed();
    const byName = await repo.spots.search({ keyword: "茶屋", sort: "popular", paging: { limit: 20 } });
    expect(byName.items.map((s) => s.name)).toContain("ひがし茶屋街");
    expect(byName.items.every((s) => normalizeName(`${s.name}${s.city ?? ""}`).includes("茶屋"))).toBe(true);
    // 半角カナ・ひらがな・空白の表記ゆれ
    const fuzzy = await repo.spots.search({
      keyword: "くるーず ﾀｰﾐﾅﾙ",
      sort: "popular",
      paging: { limit: 20 },
    });
    expect(fuzzy.items.map((s) => s.name)).toEqual(["金沢港クルーズターミナル"]);
    const byCity = await repo.spots.search({ city: "野々市市", sort: "popular", paging: { limit: 50 } });
    expect(byCity.items.length).toBeGreaterThan(0);
    expect(byCity.items.every((s) => s.city === "野々市市")).toBe(true);
    const popular = await repo.spots.search({ sort: "popular", paging: { limit: 50 } });
    const score = (s: { postCount: number; likeCount: number }) => s.postCount + s.likeCount;
    for (let i = 1; i < popular.items.length; i += 1)
      expect(score(popular.items[i - 1])).toBeGreaterThanOrEqual(score(popular.items[i]));
    const newest = await repo.spots.search({ sort: "newest", category: "history", paging: { limit: 50 } });
    expect(newest.items.every((s) => s.category === "history")).toBe(true);
    const details = await Promise.all(newest.items.map((s) => repo.spots.getById(s.id)));
    for (let i = 1; i < details.length; i += 1)
      expect(details[i - 1]!.createdAt >= details[i]!.createdAt).toBe(true);
    const none = await repo.spots.search({
      keyword: "存在しないスポット",
      sort: "popular",
      paging: { limit: 20 },
    });
    expect(none.items).toEqual([]);
    expect(none.nextCursor).toBeNull();
  });

  it("findSimilarName は半径内で正規化した名前が一致または包含するものを返す", async () => {
    const repo = repoWithSeed();
    const hit = await repo.spots.findSimilarName({
      name: "兼 六 園",
      lat: 36.5619,
      lng: 136.6625,
      radiusM: 50,
    });
    expect(hit.map((s) => s.name)).toEqual(["兼六園"]);
    const kana = await repo.spots.findSimilarName({
      name: "くるーずたーみなる",
      lat: 36.6113,
      lng: 136.6085,
      radiusM: 50,
    });
    expect(kana.map((s) => s.name)).toEqual(["金沢港クルーズターミナル"]);
    const partial = await repo.spots.findSimilarName({
      name: "茶屋街",
      lat: 36.5725,
      lng: 136.6672,
      radiusM: 50,
    });
    expect(partial.map((s) => s.name)).toEqual(["ひがし茶屋街"]);
    const far = await repo.spots.findSimilarName({ name: "兼六園", lat: 36.5619, lng: 136.667, radiusM: 50 });
    expect(far).toEqual([]);
  });
});

describe("posts と recomputeStats", () => {
  it("create 後に postCount / cover / median / hourHistogram が更新され、0件になると地図から消える", async () => {
    const repo = createMemoryRepository(false, { persist: false });
    await repo.profiles.create({ id: SEED_USER_IDS.userA, displayName: "A" });
    await repo.profiles.create({ id: SEED_USER_IDS.userB, displayName: "B" });
    const spot = await repo.spots.create({
      name: "テスト神社",
      lat: 36.5,
      lng: 136.6,
      category: "other",
      source: "gps",
      createdBy: SEED_USER_IDS.userA,
    });

    expect(await repo.spots.inBbox({ bbox: KANAZAWA_BBOX, limit: 10 })).toEqual([]);
    expect((await repo.spots.getById(spot.id))?.postCount).toBe(0);

    // createdAt が同じミリ秒にならないよう間隔を空ける（「同数なら新しい投稿」の判定のため）
    const p1 = await repo.posts.create({
      userId: SEED_USER_IDS.userA,
      spotId: spot.id,
      comment: "一件目",
      category: "history",
      stayDuration: "lt30",
      images: [IMG(1)],
    });
    await tick();
    const p2 = await repo.posts.create({
      userId: SEED_USER_IDS.userB,
      spotId: spot.id,
      comment: "二件目",
      category: "history",
      stayDuration: "lt120",
      images: [IMG(2), { ...IMG(3), sortOrder: 1 }],
    });
    await tick();
    const p3 = await repo.posts.create({
      userId: SEED_USER_IDS.userA,
      spotId: spot.id,
      comment: "三件目",
      category: "photogenic",
      stayDuration: "lt60",
      images: [IMG(4)],
    });
    await repo.spots.recomputeStats(spot.id);

    const d1 = await repo.spots.getById(spot.id);
    expect(d1?.postCount).toBe(3);
    expect(d1?.category).toBe("history");
    // 中央値：30, 60, 120 → 60
    expect(d1?.stayMinutesMedian).toBe(STAY_DURATION_MINUTES.lt60);
    expect(d1?.hourHistogram).toHaveLength(24);
    expect(d1?.hourHistogram.reduce((a, b) => a + b, 0)).toBe(3);
    expect(d1?.hourHistogram[jstHour(p1.createdAt)]).toBeGreaterThanOrEqual(1);
    // いいね同数（0）なら新しい投稿の最初の画像が代表写真
    expect(d1?.coverThumbUrl).toBe("/api/dev/files/seed/test/4_t.svg");
    expect(d1?.coverFullUrl).toBe("/api/dev/files/seed/test/4.svg");

    // いいね最多の投稿が代表写真になる
    await repo.likes.add(SEED_USER_IDS.userA, p2.id);
    await repo.spots.recomputeStats(spot.id);
    const d2 = await repo.spots.getById(spot.id);
    expect(d2?.likeCount).toBe(1);
    expect(d2?.coverThumbUrl).toBe("/api/dev/files/seed/test/2_t.svg");

    // 4件目で中央値は偶数個 → 小さい方（30,60,120,240 → 60）
    await repo.posts.create({
      userId: SEED_USER_IDS.userB,
      spotId: spot.id,
      comment: "四件目",
      category: "history",
      stayDuration: "half_day",
      images: [IMG(5)],
    });
    await repo.spots.recomputeStats(spot.id);
    expect((await repo.spots.getById(spot.id))?.stayMinutesMedian).toBe(60);

    // hidden は数えない。本人と管理者だけが見える
    await repo.posts.setStatus(p3.id, "hidden");
    await repo.spots.recomputeStats(spot.id);
    expect((await repo.spots.getById(spot.id))?.postCount).toBe(3);
    expect(await repo.posts.getById(p3.id)).toBeNull();
    expect(await repo.posts.getById(p3.id, SEED_USER_IDS.userB)).toBeNull();
    expect((await repo.posts.getById(p3.id, SEED_USER_IDS.userA))?.status).toBe("hidden");
    const bySpot = await repo.posts.listBySpot(spot.id, { limit: 10 });
    expect(bySpot.items.map((p) => p.id)).not.toContain(p3.id);
    expect(bySpot.items[0].spotName).toBe("テスト神社");
    expect(bySpot.items[0].author.displayName).toMatch(/^[AB]$/);

    // 削除：画像パスが返り、0件になると地図から消えるが getById は返す
    const paths: string[] = [];
    for (const p of [...bySpot.items, await repo.posts.getById(p3.id, SEED_USER_IDS.userA)]) {
      const r = await repo.posts.delete(p!.id);
      paths.push(...r.deletedImagePaths);
    }
    expect(paths.sort()).toEqual(
      [
        "seed/test/1.svg",
        "seed/test/1_t.svg",
        "seed/test/2.svg",
        "seed/test/2_t.svg",
        "seed/test/3.svg",
        "seed/test/3_t.svg",
        "seed/test/4.svg",
        "seed/test/4_t.svg",
        "seed/test/5.svg",
        "seed/test/5_t.svg",
      ].sort(),
    );
    await repo.spots.recomputeStats(spot.id);
    const d3 = await repo.spots.getById(spot.id);
    expect(d3?.postCount).toBe(0);
    expect(d3?.coverThumbUrl).toBeNull();
    expect(d3?.stayMinutesMedian).toBeNull();
    expect(await repo.spots.inBbox({ bbox: KANAZAWA_BBOX, limit: 10 })).toEqual([]);
    expect(await repo.spots.nearby({ lat: 36.5, lng: 136.6, radiusM: 100, limit: 10 })).toEqual([]);
    expect((await repo.spots.search({ sort: "popular", paging: { limit: 10 } })).items).toEqual([]);
  });

  it("update で画像を置き換え、countRecentByUser は now を受け取る", async () => {
    const repo = repoWithSeed();
    const data = buildSeedData();
    const spot = data.spots[0];
    const created = await repo.posts.create({
      userId: SEED_USER_IDS.userA,
      spotId: spot.id,
      comment: "新規",
      category: "history",
      stayDuration: null,
      images: [IMG(1)],
    });
    const updated = await repo.posts.update(created.id, {
      comment: "編集済み",
      images: [IMG(7), { ...IMG(8), sortOrder: 1 }],
    });
    expect(updated.comment).toBe("編集済み");
    expect(updated.images.map((i) => i.thumbUrl)).toEqual([
      "/api/dev/files/seed/test/7_t.svg",
      "/api/dev/files/seed/test/8_t.svg",
    ]);
    expect(await repo.posts.countRecentByUser(SEED_USER_IDS.userA, 60_000)).toBe(1);
    expect(
      await repo.posts.countRecentByUser(SEED_USER_IDS.userA, 60_000, new Date(Date.now() + 120_000)),
    ).toBe(0);
  });
});

describe("likes", () => {
  it("add / remove は冪等で、likedByMe に反映される", async () => {
    const repo = repoWithSeed();
    const data = buildSeedData();
    const post = data.posts.find((p) => p.likeCount === 0 && p.userId !== SEED_USER_IDS.admin)!;
    const base = (await repo.posts.getById(post.id))!.likeCount;
    expect(await repo.likes.add(SEED_USER_IDS.admin, post.id)).toEqual({ likeCount: base + 1 });
    expect(await repo.likes.add(SEED_USER_IDS.admin, post.id)).toEqual({ likeCount: base + 1 });
    expect((await repo.posts.getById(post.id, SEED_USER_IDS.admin))?.likedByMe).toBe(true);
    expect((await repo.posts.getById(post.id, SEED_USER_IDS.userA))?.likedByMe).toBe(false);
    expect(await repo.likes.remove(SEED_USER_IDS.admin, post.id)).toEqual({ likeCount: base });
    expect(await repo.likes.remove(SEED_USER_IDS.admin, post.id)).toEqual({ likeCount: base });
    expect((await repo.posts.getById(post.id, SEED_USER_IDS.admin))?.likedByMe).toBe(false);
  });
});

describe("wishlists と plans", () => {
  it("addItem の重複は added=false、削除済みスポットは null、plans は listByWishlist で取れる", async () => {
    const repo = repoWithSeed();
    const data = buildSeedData();
    const [s1, s2] = data.spots;
    const list = await repo.wishlists.create({ userId: SEED_USER_IDS.userA, name: "金沢旅行" });
    expect(await repo.wishlists.countByUser(SEED_USER_IDS.userA)).toBe(1);
    expect(await repo.wishlists.addItem(list.id, s1.id)).toEqual({ added: true, itemCount: 1 });
    expect(await repo.wishlists.addItem(list.id, s1.id)).toEqual({ added: false, itemCount: 1 });
    expect(await repo.wishlists.addItem(list.id, s2.id)).toEqual({ added: true, itemCount: 2 });
    expect(await repo.wishlists.setMustVisit(list.id, s2.id, true)).toBe(true);
    expect(await repo.wishlists.setMustVisit(list.id, "none", true)).toBe(false);

    const plan = await repo.plans.create({
      userId: SEED_USER_IDS.userA,
      wishlistId: list.id,
      params: {
        listId: list.id,
        spotIds: [s1.id, s2.id],
        origin: { lat: 36.578, lng: 136.6478, label: "金沢駅" },
        destination: null,
        date: "2026-11-03",
        startTime: "09:00",
        endTime: "18:00",
        mode: "walking",
        pace: "normal",
        interests: [],
        lunchBreak: false,
      },
      result: {
        items: [
          {
            type: "spot",
            spotId: s1.id,
            arrive: "09:30",
            stayMin: 60,
            depart: "10:30",
            travelMinToNext: 20,
            inBestTime: true,
          },
          {
            type: "spot",
            spotId: s2.id,
            arrive: "10:50",
            stayMin: 60,
            depart: "11:50",
            travelMinToNext: null,
            inBestTime: false,
          },
        ],
        skipped: [],
        totalTravelMin: 50,
        endAt: "11:50",
        geometry: null,
        travelMatrixId: "tm_test",
        estimated: true,
      },
    });
    expect(plan.spotCount).toBe(2);

    const detail = (await repo.wishlists.getById(list.id))!;
    expect(detail.itemCount).toBe(2);
    expect(detail.items.map((i) => i.spot?.name)).toEqual([s1.name, s2.name]);
    expect(detail.items[1].mustVisit).toBe(true);
    expect(detail.plans.map((p) => p.id)).toEqual([plan.id]);

    // 共有トークン
    await repo.wishlists.setShareToken(list.id, "token-abc");
    const shared = await repo.wishlists.getByShareToken("token-abc");
    expect(shared?.name).toBe("金沢旅行");
    expect(shared?.ownerDisplayName).toBe("開発ユーザーA");
    await repo.wishlists.setShareToken(list.id, null);
    expect(await repo.wishlists.getByShareToken("token-abc")).toBeNull();

    // スポットが消えても項目は残り spot は null
    const victim = createMemoryRepository(false, { persist: false });
    await victim.profiles.create({ id: SEED_USER_IDS.userA, displayName: "A" });
    const tmpSpot = await victim.spots.create({
      name: "仮",
      lat: 35,
      lng: 135,
      category: "other",
      source: "gps",
      createdBy: SEED_USER_IDS.userA,
    });
    const l2 = await victim.wishlists.create({ userId: SEED_USER_IDS.userA, name: "仮リスト" });
    await victim.wishlists.addItem(l2.id, tmpSpot.id);
    // Repository にスポット削除はないため、存在しない ID を直接追加して削除済みを再現する
    await victim.wishlists.addItem(l2.id, "00000000-0000-4000-8000-00000000dead");
    const d2 = (await victim.wishlists.getById(l2.id))!;
    expect(d2.items.map((i) => i.spot === null)).toEqual([false, true]);

    expect(await repo.wishlists.removeItem(list.id, s1.id)).toBe(true);
    expect(await repo.wishlists.removeItem(list.id, s1.id)).toBe(false);
    await repo.wishlists.delete(list.id);
    expect(await repo.wishlists.getById(list.id)).toBeNull();
    expect(await repo.plans.getById(plan.id)).toBeNull();
  });
});

describe("ページング", () => {
  it("cursor で重複なく全件取れる（posts / spots popular / spots newest）", async () => {
    const repo = repoWithSeed();
    const data = buildSeedData();
    const spot = data.spots.reduce((a, b) => (a.postCount >= b.postCount ? a : b));

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await repo.posts.listBySpot(spot.id, { cursor, limit: 7 });
      expect(page.items.length).toBeLessThanOrEqual(7);
      seen.push(...page.items.map((p) => p.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBe(spot.postCount);
    for (let i = 1; i < seen.length; i += 1) {
      const a = data.posts.find((p) => p.id === seen[i - 1])!;
      const b = data.posts.find((p) => p.id === seen[i])!;
      expect(a.createdAt >= b.createdAt).toBe(true);
    }

    for (const sort of ["popular", "newest"] as const) {
      const ids: string[] = [];
      let c: string | undefined;
      do {
        const page = await repo.spots.search({ sort, paging: { cursor: c, limit: 9 } });
        ids.push(...page.items.map((s) => s.id));
        c = page.nextCursor ?? undefined;
      } while (c);
      expect(new Set(ids).size).toBe(data.spots.length);
    }

    const byUser = await repo.posts.listByUser(SEED_USER_IDS.userA, { limit: 5 });
    expect(byUser.items).toHaveLength(5);
    expect(byUser.items.every((p) => p.userId === SEED_USER_IDS.userA)).toBe(true);
    expect(byUser.nextCursor).not.toBeNull();
  });
});

describe("apiUsage", () => {
  it("increment は無ければ limit で作成し、listSuspended は指定 period の停止中だけ返す", async () => {
    const repo = createMemoryRepository(false, { persist: false });
    expect(await repo.apiUsage.get("ors", "route_planning", "2026-10-10")).toBeNull();
    const u1 = await repo.apiUsage.increment("ors", "route_planning", "2026-10-10", 2000);
    expect(u1).toMatchObject({
      provider: "ors",
      feature: "route_planning",
      period: "2026-10-10",
      count: 1,
      limit: 2000,
      suspendedAt: null,
    });
    const u2 = await repo.apiUsage.increment("ors", "route_planning", "2026-10-10", 9999, 4);
    expect(u2.count).toBe(5);
    expect(u2.limit).toBe(2000);
    await repo.apiUsage.set("supabase", "post_create", "2026-10", 900, 1000);
    await repo.apiUsage.setSuspended("supabase", "post_create", "2026-10", "2026-10-10T12:00:00.000+09:00");
    await repo.apiUsage.increment("nominatim", "external_search", "2026-10-09", 500);
    await repo.apiUsage.setSuspended(
      "nominatim",
      "external_search",
      "2026-10-09",
      "2026-10-09T23:00:00.000+09:00",
    );

    const suspended = await repo.apiUsage.listSuspended(["2026-10-10", "2026-10"]);
    expect(suspended.map((s) => s.feature)).toEqual(["post_create"]);
    expect(suspended[0]).toMatchObject({ provider: "supabase", period: "2026-10", count: 900, limit: 1000 });
    await repo.apiUsage.setSuspended("supabase", "post_create", "2026-10", null);
    expect(await repo.apiUsage.listSuspended(["2026-10-10", "2026-10"])).toEqual([]);
  });
});

describe("travelCache", () => {
  it("getMany は期限内のものだけ返し、purgeExpired で消える", async () => {
    const repo = createMemoryRepository(false, { persist: false });
    await repo.travelCache.putMany([
      { fromKey: "s:a", toKey: "s:b", mode: "walking", durationSec: 600, distanceM: 800 },
      { fromKey: "s:b", toKey: "s:a", mode: "walking", durationSec: 620, distanceM: 800 },
    ]);
    const pairs = [
      { fromKey: "s:a", toKey: "s:b" },
      { fromKey: "s:b", toKey: "s:a" },
      { fromKey: "s:a", toKey: "s:c" },
    ];
    const fresh = await repo.travelCache.getMany(pairs, "walking");
    expect([...fresh.keys()].sort()).toEqual(["s:a|s:b", "s:b|s:a"]);
    expect(fresh.get("s:a|s:b")?.durationSec).toBe(600);
    expect((await repo.travelCache.getMany(pairs, "driving")).size).toBe(0);

    const later = new Date(Date.now() + (LIMITS.travelCacheDays + 1) * 86_400_000);
    expect((await repo.travelCache.getMany(pairs, "walking", later)).size).toBe(0);
    expect(await repo.travelCache.purgeExpired(LIMITS.travelCacheDays, later)).toBe(2);
    expect((await repo.travelCache.getMany(pairs, "walking")).size).toBe(0);
  });
});

describe("reports", () => {
  it("同じ投稿への二重通報は created=false、count は open の件数", async () => {
    const repo = repoWithSeed();
    const data = buildSeedData();
    const post = data.posts.find((p) => p.userId === SEED_USER_IDS.userA)!;
    expect(
      await repo.reports.create({
        postId: post.id,
        reporterId: SEED_USER_IDS.userB,
        reason: "spam",
        note: null,
      }),
    ).toEqual({ created: true, count: 1 });
    expect(
      await repo.reports.create({
        postId: post.id,
        reporterId: SEED_USER_IDS.userB,
        reason: "other",
        note: "二回目",
      }),
    ).toEqual({ created: false, count: 1 });
    expect(
      await repo.reports.create({
        postId: post.id,
        reporterId: SEED_USER_IDS.admin,
        reason: "wrong_place",
        note: null,
      }),
    ).toEqual({ created: true, count: 2 });
    const open = await repo.reports.listOpen({ limit: 10 });
    expect(open.items).toHaveLength(2);
    expect(open.items[0].post?.id).toBe(post.id);
    await repo.posts.setStatus(post.id, "hidden");
    expect((await repo.reports.listOpen({ limit: 10 })).items[0].post?.status).toBe("hidden");
    await repo.reports.resolveByPost(post.id);
    expect((await repo.reports.listOpen({ limit: 10 })).items).toEqual([]);
    // 解決後も同じ人の再通報は重複扱い
    expect(
      (
        await repo.reports.create({
          postId: post.id,
          reporterId: SEED_USER_IDS.userB,
          reason: "spam",
          note: null,
        })
      ).created,
    ).toBe(false);
  });
});

describe("profiles", () => {
  it("deleteAccount で投稿・いいね・リスト・プラン・通報が消え、スポット統計が更新される", async () => {
    const repo = repoWithSeed();
    const data = buildSeedData();
    const userId = SEED_USER_IDS.userB;
    const myPosts = data.posts.filter((p) => p.userId === userId);
    const otherPost = data.posts.find((p) => p.userId === SEED_USER_IDS.userA)!;
    const list = await repo.wishlists.create({ userId, name: "消えるリスト" });
    await repo.likes.add(userId, otherPost.id);
    const likedCount = (await repo.posts.getById(otherPost.id))!.likeCount;
    await repo.reports.create({ postId: otherPost.id, reporterId: userId, reason: "spam", note: null });

    const { deletedImagePaths } = await repo.profiles.deleteAccount(userId);
    const expectedPaths = data.images
      .filter((i) => myPosts.some((p) => p.id === i.postId))
      .flatMap((i) => [i.fullPath, i.thumbPath]);
    expect(deletedImagePaths.sort()).toEqual(expectedPaths.sort());

    expect(await repo.profiles.getById(userId)).toBeNull();
    expect((await repo.posts.listByUser(userId, { limit: 50 })).items).toEqual([]);
    for (const p of myPosts) expect(await repo.posts.getById(p.id, SEED_USER_IDS.admin)).toBeNull();
    expect(await repo.wishlists.getById(list.id)).toBeNull();
    expect((await repo.posts.getById(otherPost.id))!.likeCount).toBe(likedCount - 1);
    expect((await repo.reports.listOpen({ limit: 10 })).items).toEqual([]);

    const spots = await repo.spots.inBbox({ bbox: KANAZAWA_BBOX, limit: 1000 });
    expect(spots.reduce((s, x) => s + x.postCount, 0)).toBe(data.posts.length - myPosts.length);
    // 退会者だけが投稿していたスポットは地図から消える
    const onlyMine = data.spots.filter((s) =>
      data.posts.filter((p) => p.spotId === s.id).every((p) => p.userId === userId),
    );
    for (const s of onlyMine) expect(spots.find((x) => x.id === s.id)).toBeUndefined();
    const other = await repo.posts.getById(otherPost.id);
    expect(other?.author.displayName).toBe("開発ユーザーA");
  });

  it("create は既存ならそのまま返し、update で表示名を変えられる", async () => {
    const repo = repoWithSeed();
    const same = await repo.profiles.create({ id: SEED_USER_IDS.userA, displayName: "別名" });
    expect(same.displayName).toBe("開発ユーザーA");
    const updated = await repo.profiles.update(SEED_USER_IDS.userA, {
      displayName: "新しい名前",
      avatarUrl: "https://example.com/a.png",
    });
    expect(updated).toMatchObject({ displayName: "新しい名前", avatarUrl: "https://example.com/a.png" });
  });
});

describe("storage", () => {
  it("署名付きアップロード先の発行・検証・確定・削除が <dataDir>/uploads で動く", async () => {
    const dataDir = await mkTmp();
    const repo = createMemoryRepository(false, { persist: false, dataDir });
    const targets = await repo.storage.createSignedUploads(SEED_USER_IDS.userA, [
      { kind: "full", contentType: "image/webp", size: 1000 },
      { kind: "thumb", contentType: "image/webp", size: 100 },
    ]);
    expect(targets).toHaveLength(2);
    expect(targets[0].path).toMatch(new RegExp(`^posts/tmp/${SEED_USER_IDS.userA}/[0-9a-f-]+\\.webp$`));
    expect(targets[1].path).toBe(targets[0].path.replace(/\.webp$/, "_t.webp"));
    const url = new URL(targets[0].signedUrl, "http://localhost");
    expect(url.pathname).toBe("/api/dev/uploads");
    const token = url.searchParams.get("token")!;
    expect(repo.verifyUploadToken(targets[0].path, token)).toBe(true);
    expect(repo.verifyUploadToken(targets[1].path, token)).toBe(false);
    expect(repo.verifyUploadToken(targets[0].path, token, new Date(Date.now() + 2 * 3_600_000))).toBe(false);

    await repo.writeUploadFile(targets[0].path, new Uint8Array([1, 2, 3]));
    await repo.writeUploadFile(targets[1].path, new Uint8Array([4]));
    expect((await repo.readUploadFile(targets[0].path))?.byteLength).toBe(3);
    expect(await repo.readUploadFile("../etc/passwd")).toBeNull();

    const finalized = await repo.storage.finalizePostImages("post1", [
      { fullPath: targets[0].path, thumbPath: targets[1].path },
      { fullPath: "seed/x/1.svg", thumbPath: "seed/x/1_t.svg" },
    ]);
    expect(finalized[0].fullPath).toBe(`posts/post1/${path.basename(targets[0].path)}`);
    expect(finalized[1]).toEqual({ fullPath: "seed/x/1.svg", thumbPath: "seed/x/1_t.svg" });
    expect(fs.existsSync(path.join(dataDir, "uploads", finalized[0].fullPath))).toBe(true);
    expect(fs.existsSync(path.join(dataDir, "uploads", targets[0].path))).toBe(false);
    expect(repo.storage.publicUrl(finalized[0].fullPath)).toBe(`/api/dev/files/${finalized[0].fullPath}`);
    await expect(
      repo.storage.finalizePostImages("post2", [{ fullPath: targets[0].path, thumbPath: targets[1].path }]),
    ).rejects.toThrow();

    await repo.storage.deleteObjects([finalized[0].fullPath, finalized[0].thumbPath, "seed/x/1.svg"]);
    expect(fs.existsSync(path.join(dataDir, "uploads", finalized[0].fullPath))).toBe(false);

    // 古い一時ファイルの削除
    const stale = `posts/tmp/${SEED_USER_IDS.userA}/stale.webp`;
    await repo.writeUploadFile(stale, new Uint8Array([9]));
    expect(await repo.storage.deleteStaleTmp(24)).toBe(0);
    expect(await repo.storage.deleteStaleTmp(24, new Date(Date.now() + 25 * 3_600_000))).toBe(1);
    expect(await repo.readUploadFile(stale)).toBeNull();
  });
});

describe("永続化", () => {
  it("persist=true なら memory.json に保存され、次のインスタンスで読み込まれる", async () => {
    const dataDir = await mkTmp();
    const repo = createMemoryRepository(true, { persist: true, dataDir });
    const list = await repo.wishlists.create({ userId: SEED_USER_IDS.userA, name: "保存されるリスト" });
    await repo.flush();
    expect(fs.existsSync(path.join(dataDir, "memory.json"))).toBe(true);
    const again = createMemoryRepository(true, { persist: true, dataDir });
    expect((await again.wishlists.getById(list.id))?.name).toBe("保存されるリスト");
    expect((await again.spots.inBbox({ bbox: KANAZAWA_BBOX, limit: 1000 })).length).toBe(
      buildSeedData().spots.length,
    );
    const noPersist = createMemoryRepository(true, { persist: false, dataDir });
    expect(await noPersist.wishlists.getById(list.id)).toBeNull();
  });
});
