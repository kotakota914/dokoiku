/**
 * 投稿の作成・編集・削除・いいね・管理者による表示切り替えの業務ロジック（F-2、F-3-3、F-7-3）。
 * - Route Handler は「認証 → 入力検証 → ここを呼ぶ → レスポンス」だけにする。
 * - Repository の契約（src/lib/repo/types.ts）だけに依存し、権限チェックと業務ルールはここで ApiError にする。
 * - 投稿・いいね・表示切り替えのあとは必ず repo.spots.recomputeStats(spotId) を呼ぶ（F-2-13）。
 */
import { ApiError } from "@/lib/api/errors";
import { checkRateLimit, peekRateLimit } from "@/lib/api/ratelimit";
import { serverConfig } from "@/lib/config";
import { LIMITS } from "@/lib/domain/constants";
import type { PostImage, PostStatus, PostView, SpotSummary } from "@/lib/domain/types";
import { reverseGeocode as nominatimReverseGeocode } from "@/lib/external/nominatim";
import { checkAndCount, isSuspended, suspendedMessage } from "@/lib/external/usage";
import type { Repository } from "@/lib/repo/types";
import type { CreatePostInput, NewSpotInput, UpdatePostInput } from "@/lib/validation/schemas";

export interface GeocodedAddress {
  address: string | null;
  prefecture: string | null;
  city: string | null;
}

export interface PostServiceDeps {
  /** テストで時刻を固定する */
  now?: Date;
  /** テストで逆ジオコーディングを差し替える。既定は Nominatim（無効・停止中・失敗は null） */
  reverseGeocode?: (repo: Repository, lat: number, lng: number) => Promise<GeocodedAddress | null>;
}

type ImageInput = { fullPath: string; thumbPath: string; width: number; height: number };

/** ユーザー自身の一時アップロード先の接頭辞 */
export function tmpPrefixFor(userId: string): string {
  return `posts/tmp/${userId}/`;
}

function finalizedPrefixFor(postId: string): string {
  return `posts/${postId}/`;
}

function isSafePath(p: string): boolean {
  return !p.includes("..") && !p.includes("\\") && !p.startsWith("/");
}

function isOwnTmpPath(userId: string, p: string): boolean {
  return isSafePath(p) && p.startsWith(tmpPrefixFor(userId)) && p.length > tmpPrefixFor(userId).length;
}

/** 画像パスが本人の一時アップロード先だけで構成されているか（他人のパス・確定済みパスは 400） */
export function assertOwnTmpPaths(userId: string, images: ImageInput[]): void {
  for (const img of images) {
    if (!isOwnTmpPath(userId, img.fullPath) || !isOwnTmpPath(userId, img.thumbPath)) {
      throw ApiError.validation("画像のアップロード先が正しくありません。写真を選び直してください", [
        { field: "images", reason: "invalid_path" },
      ]);
    }
  }
}

/** 既定の逆ジオコーディング：Nominatim が有効で停止中でないときだけ呼び、失敗はすべて null にする */
export async function defaultReverseGeocode(
  repo: Repository,
  lat: number,
  lng: number,
): Promise<GeocodedAddress | null> {
  if (!serverConfig.nominatimEnabled) return null;
  try {
    await checkAndCount(repo.apiUsage, "nominatim");
    const place = await nominatimReverseGeocode(lat, lng);
    if (!place) return null;
    return { address: place.address, prefecture: place.prefecture, city: place.city };
  } catch (err) {
    console.warn("[posts] 逆ジオコーディングを省略しました", err instanceof Error ? err.message : err);
    return null;
  }
}

function postRateLimitKey(userId: string): string {
  return `posts:${userId}`;
}

/**
 * レート制限（9.1：投稿は 1 分に 5 件まで）は「作成された投稿」だけを数える。
 * プロセス内カウンタは入口では peek だけ行い、投稿の作成に成功したあとで加算する（409・400・404 の試行は数えない）。
 */
async function assertPostCreateAvailable(repo: Repository, userId: string, now: Date): Promise<void> {
  const allowedInProcess = peekRateLimit(
    postRateLimitKey(userId),
    LIMITS.postsPerMinute,
    60_000,
    now.getTime(),
  );
  const recent = await repo.posts.countRecentByUser(userId, 60_000);
  if (!allowedInProcess || recent >= LIMITS.postsPerMinute) {
    throw ApiError.rateLimited(
      `投稿は1分間に${LIMITS.postsPerMinute}件までです。しばらく待ってからもう一度お試しください`,
    );
  }
  if (await isSuspended(repo.apiUsage, "post_create", now)) {
    throw ApiError.suspended("post_create", suspendedMessage("post_create"));
  }
}

/** 新規スポット（Q7）：半径 50m 内の似た名前があれば 409 と候補、無ければ作成して ID を返す */
async function resolveNewSpot(
  repo: Repository,
  userId: string,
  input: NewSpotInput,
  category: CreatePostInput["category"],
  deps: PostServiceDeps,
): Promise<string> {
  const candidates: SpotSummary[] = await repo.spots.findSimilarName({
    name: input.name,
    lat: input.lat,
    lng: input.lng,
    radiusM: LIMITS.duplicateSpotRadiusM,
  });
  if (candidates.length > 0) {
    throw ApiError.conflict("同じ場所のスポットがあります", { candidates });
  }
  let address = input.address ?? null;
  let prefecture = input.prefecture ?? null;
  let city = input.city ?? null;
  if (input.source === "gps" && !address) {
    const geo = await (deps.reverseGeocode ?? defaultReverseGeocode)(repo, input.lat, input.lng);
    if (geo) {
      address = geo.address;
      prefecture = prefecture ?? geo.prefecture;
      city = city ?? geo.city;
    }
  }
  const spot = await repo.spots.create({
    name: input.name,
    lat: input.lat,
    lng: input.lng,
    category,
    source: input.source,
    externalRef: input.externalRef ?? null,
    address,
    prefecture,
    city,
    createdBy: userId,
  });
  return spot.id;
}

function toPostImages(
  images: ImageInput[],
  paths: { fullPath: string; thumbPath: string }[],
): Omit<PostImage, "id">[] {
  return images.map((img, idx) => ({
    fullPath: paths[idx].fullPath,
    thumbPath: paths[idx].thumbPath,
    width: img.width,
    height: img.height,
    sortOrder: idx,
  }));
}

/** 一時パスを確定パスへ移す。失敗は 400（アップロードが完了していない・期限切れ） */
async function finalizeImages(
  repo: Repository,
  postId: string,
  images: ImageInput[],
): Promise<{ fullPath: string; thumbPath: string }[]> {
  try {
    return await repo.storage.finalizePostImages(
      postId,
      images.map((i) => ({ fullPath: i.fullPath, thumbPath: i.thumbPath })),
    );
  } catch (err) {
    // Storage 側のサイズ・形式の確認（413 PAYLOAD_TOO_LARGE）はそのまま返す（api-02）
    if (err instanceof ApiError) throw err;
    console.warn("[posts] 画像の確定に失敗しました", err instanceof Error ? err.message : err);
    throw ApiError.validation(
      "アップロードした写真が見つかりません。写真をもう一度アップロードしてください",
      [{ field: "images", reason: "upload_missing" }],
    );
  }
}

/** 画像の削除失敗で本処理を失敗にしない（残ったファイルは定期処理で扱う） */
async function deleteObjectsQuietly(repo: Repository, paths: string[]): Promise<void> {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (unique.length === 0) return;
  try {
    await repo.storage.deleteObjects(unique);
  } catch (err) {
    console.error("[posts] 写真の削除に失敗しました", err instanceof Error ? err.message : err);
  }
}

function imagePathsOf(post: PostView): string[] {
  const out: string[] = [];
  for (const img of post.images) {
    if (img.fullPath) out.push(img.fullPath);
    if (img.thumbPath) out.push(img.thumbPath);
  }
  return out;
}

// ---------- 作成 ----------

/**
 * POST /posts（9.3）。
 * 1. レート制限（プロセス内＋DB） 2. 停止中 3. 画像パスの所有確認 4. 新規スポットの重複判定と作成
 * 5. 投稿作成（tmp パスのまま）→ 画像の確定 → 画像の置き換え 6. 統計更新
 */
export async function createPost(
  repo: Repository,
  userId: string,
  input: CreatePostInput,
  deps: PostServiceDeps = {},
): Promise<{ post: PostView; spotId: string }> {
  const now = deps.now ?? new Date();
  await assertPostCreateAvailable(repo, userId, now);
  assertOwnTmpPaths(userId, input.images);

  let spotId: string;
  if (input.newSpot) {
    spotId = await resolveNewSpot(repo, userId, input.newSpot, input.category, deps);
  } else {
    spotId = input.spotId as string;
    const spot = await repo.spots.getById(spotId);
    if (!spot) throw ApiError.notFound("このスポットは見つかりませんでした");
  }

  const created = await repo.posts.create({
    userId,
    spotId,
    comment: input.comment,
    category: input.category,
    stayDuration: input.stayDuration,
    images: toPostImages(input.images, input.images),
  });
  checkRateLimit(postRateLimitKey(userId), LIMITS.postsPerMinute, 60_000, now.getTime());

  let finalPaths: { fullPath: string; thumbPath: string }[];
  try {
    finalPaths = await finalizeImages(repo, created.id, input.images);
  } catch (err) {
    // 画像を確定できなければ投稿を残さない
    await repo.posts.delete(created.id);
    await repo.spots.recomputeStats(spotId);
    throw err;
  }
  const post = await repo.posts.update(created.id, { images: toPostImages(input.images, finalPaths) });
  await repo.spots.recomputeStats(spotId);
  return { post: { ...post, likedByMe: false }, spotId };
}

// ---------- 編集 ----------

/**
 * PATCH /posts/{postId}（F-2-12。本人のみ）。通報などで非表示になった投稿は本人でも編集できない（403。10.3）。
 * images を指定したときは、本人の一時パス（新しい写真）とこの投稿の確定済みパス（残す写真）だけを受け付け、
 * 一時パスは確定してから画像一式を置き換え、使わなくなった古い画像を Storage から削除する。
 */
export async function updatePost(
  repo: Repository,
  userId: string,
  postId: string,
  input: UpdatePostInput,
): Promise<PostView> {
  const current = await repo.posts.getById(postId, userId);
  if (!current) throw ApiError.notFound("この投稿は見つかりませんでした");
  if (current.userId !== userId) throw ApiError.forbidden("自分の投稿だけ編集できます");
  if (current.status === "hidden") throw ApiError.forbidden("非表示の投稿は編集できません");

  const patch: Parameters<Repository["posts"]["update"]>[1] = {};
  if (input.comment !== undefined) patch.comment = input.comment;
  if (input.category !== undefined) patch.category = input.category;
  if (input.stayDuration !== undefined) patch.stayDuration = input.stayDuration;

  let obsoletePaths: string[] = [];
  if (input.images !== undefined) {
    const keepPrefix = finalizedPrefixFor(postId);
    const isKept = (p: string) => isSafePath(p) && p.startsWith(keepPrefix) && p.length > keepPrefix.length;
    for (const img of input.images) {
      const keep = isKept(img.fullPath) && isKept(img.thumbPath);
      const fresh = isOwnTmpPath(userId, img.fullPath) && isOwnTmpPath(userId, img.thumbPath);
      if (!keep && !fresh) {
        throw ApiError.validation("画像のアップロード先が正しくありません。写真を選び直してください", [
          { field: "images", reason: "invalid_path" },
        ]);
      }
    }
    const fresh = input.images.filter((img) => !isKept(img.fullPath));
    const finalized = fresh.length > 0 ? await finalizeImages(repo, postId, fresh) : [];
    let fi = 0;
    const resolved = input.images.map((img) => {
      if (isKept(img.fullPath)) return { fullPath: img.fullPath, thumbPath: img.thumbPath };
      return finalized[fi++];
    });
    patch.images = toPostImages(input.images, resolved);
    const keptPaths = new Set(resolved.flatMap((p) => [p.fullPath, p.thumbPath]));
    obsoletePaths = imagePathsOf(current).filter((p) => !keptPaths.has(p));
  }

  const updated = await repo.posts.update(postId, patch);
  await deleteObjectsQuietly(repo, obsoletePaths);
  await repo.spots.recomputeStats(updated.spotId);
  return { ...updated, likedByMe: current.likedByMe };
}

// ---------- 削除 ----------

/** DELETE /posts/{postId}（本人または管理者） */
export async function deletePost(
  repo: Repository,
  user: { id: string; isAdmin: boolean },
  postId: string,
): Promise<void> {
  const post = await repo.posts.getById(postId, user.id);
  if (!post) throw ApiError.notFound("この投稿は見つかりませんでした");
  if (post.userId !== user.id && !user.isAdmin) throw ApiError.forbidden("自分の投稿だけ削除できます");
  const { deletedImagePaths } = await repo.posts.delete(postId);
  await deleteObjectsQuietly(repo, deletedImagePaths);
  await repo.spots.recomputeStats(post.spotId);
}

// ---------- いいね（F-3-3） ----------

export async function likePost(
  repo: Repository,
  userId: string,
  postId: string,
): Promise<{ likeCount: number }> {
  const post = await repo.posts.getById(postId, userId);
  if (!post) throw ApiError.notFound("この投稿は見つかりませんでした");
  const result = await repo.likes.add(userId, postId);
  await repo.spots.recomputeStats(post.spotId);
  return { likeCount: result.likeCount };
}

export async function unlikePost(
  repo: Repository,
  userId: string,
  postId: string,
): Promise<{ likeCount: number }> {
  const post = await repo.posts.getById(postId, userId);
  if (!post) throw ApiError.notFound("この投稿は見つかりませんでした");
  const result = await repo.likes.remove(userId, postId);
  await repo.spots.recomputeStats(post.spotId);
  return { likeCount: result.likeCount };
}

// ---------- 管理（F-7-3） ----------

/**
 * PATCH /admin/posts/{postId}：非表示・再表示（F-7-3）。
 * 管理者が確認して状態を決めた時点で、その投稿の未処理の通報は非表示・再表示のどちらでも解決済みにする
 * （非表示のままでも通報一覧に残り続けないようにする）。
 */
export async function adminSetPostStatus(
  repo: Repository,
  adminId: string,
  postId: string,
  status: PostStatus,
): Promise<PostView> {
  const post = await repo.posts.getById(postId, adminId);
  if (!post) throw ApiError.notFound("この投稿は見つかりませんでした");
  await repo.posts.setStatus(postId, status);
  await repo.reports.resolveByPost(postId);
  await repo.spots.recomputeStats(post.spotId);
  const updated = await repo.posts.getById(postId, adminId);
  if (!updated) throw ApiError.notFound("この投稿は見つかりませんでした");
  return updated;
}
