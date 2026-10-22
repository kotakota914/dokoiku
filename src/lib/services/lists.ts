/**
 * 行きたい場所リスト API の業務ロジック（F-4）。
 * Route Handler は「認証 → 入力検証 → ここを呼ぶ → レスポンス」だけを行う。
 * Repository の契約（src/lib/repo/types.ts）だけに依存し、"server-only" は import しない（vitest から直接テストするため）。
 * 権限（本人かどうか）はここで確認する。Repository は確認しない。
 */
import { ApiError } from "@/lib/api/errors";
import { serverConfig } from "@/lib/config";
import { LIMITS } from "@/lib/domain/constants";
import type { SharedWishlist, Wishlist, WishlistDetail } from "@/lib/domain/types";
import type { Repository } from "@/lib/repo/types";
import { newShareToken } from "@/lib/utils/id";
import type { UpdateListInput } from "@/lib/validation/schemas";

export const LIST_NOT_FOUND_MESSAGE = "リストが見つかりませんでした";
export const LISTS_LIMIT_MESSAGE = `リストは${LIMITS.listsPerUser}件までです`;
export const ITEMS_LIMIT_MESSAGE = `リストは${LIMITS.itemsPerList}か所までです`;
export const ALREADY_ADDED_MESSAGE = "追加済みです";
export const ITEM_NOT_FOUND_MESSAGE = "このスポットはリストに入っていません";
export const SPOT_NOT_FOUND_MESSAGE = "このスポットは見つかりませんでした";
export const SHARED_NOT_FOUND_MESSAGE = "このリストは共有されていません";

type ListsDeps = Pick<Repository, "wishlists">;
type ListItemsDeps = Pick<Repository, "wishlists" | "spots">;

/** 共有 URL を組み立てる（`${siteUrl}/shared/${token}`） */
export function sharedListUrl(token: string, siteUrl: string = serverConfig.siteUrl): string {
  return `${siteUrl.replace(/\/+$/, "")}/shared/${token}`;
}

/**
 * 本人のリストを取得する。無ければ 404、他人のものなら 403。
 * 一覧（GET /lists/{listId}）と各操作の権限確認の両方で使う。
 */
export async function getOwnedWishlist(
  repo: ListsDeps,
  userId: string,
  listId: string,
): Promise<WishlistDetail> {
  const list = await repo.wishlists.getById(listId);
  if (!list) throw ApiError.notFound(LIST_NOT_FOUND_MESSAGE);
  if (list.userId !== userId) throw ApiError.forbidden();
  return list;
}

/** GET /lists */
export async function listWishlists(repo: ListsDeps, userId: string): Promise<{ lists: Wishlist[] }> {
  const lists = await repo.wishlists.listByUser(userId);
  return { lists };
}

/** POST /lists（F-4-1）：1 ユーザー最大 LIMITS.listsPerUser 件。超えると 409 */
export async function createWishlist(
  repo: ListsDeps,
  userId: string,
  input: { name: string },
): Promise<Wishlist> {
  const count = await repo.wishlists.countByUser(userId);
  if (count >= LIMITS.listsPerUser) throw ApiError.conflict(LISTS_LIMIT_MESSAGE);
  return repo.wishlists.create({ userId, name: input.name });
}

/** PATCH /lists/{listId}（F-4-1）：名前だけを変える（updateWishlist の互換ラッパー） */
export async function renameWishlist(
  repo: ListsDeps,
  userId: string,
  listId: string,
  input: { name: string },
): Promise<Wishlist> {
  await getOwnedWishlist(repo, userId, listId);
  return repo.wishlists.rename(listId, input.name);
}

/** WishlistDetail から items / plans を落として Wishlist にする */
function toWishlist(detail: WishlistDetail): Wishlist {
  const { items, plans, ...list } = detail;
  void items;
  void plans;
  return list;
}

/**
 * PATCH /lists/{listId}（v0.3 F-4-1 / F-4-8）：名前と拠点の変更。
 * name があれば名前変更、base があれば拠点の設定（null で解除）。両方あれば順に適用する。
 * 拠点は名前と座標を保存するだけで、外部 API は呼ばない（F-4-8 受け入れ基準）。
 */
export async function updateWishlist(
  repo: ListsDeps,
  userId: string,
  listId: string,
  input: UpdateListInput,
): Promise<Wishlist> {
  const current = await getOwnedWishlist(repo, userId, listId);
  let updated = toWishlist(current);
  if (input.name !== undefined) updated = await repo.wishlists.rename(listId, input.name);
  if (input.base !== undefined) {
    updated = await repo.wishlists.setBase(
      listId,
      input.base ? { label: input.base.label, location: input.base.location } : null,
    );
  }
  return updated;
}

/** DELETE /lists/{listId}（F-4-1）：リストに属するプランも Repository 側で消える */
export async function deleteWishlist(repo: ListsDeps, userId: string, listId: string): Promise<void> {
  await getOwnedWishlist(repo, userId, listId);
  await repo.wishlists.delete(listId);
}

/**
 * POST /lists/{listId}/items（F-4-2）
 * スポットが無ければ 404、LIMITS.itemsPerList 件に達していれば 409、重複は 409「追加済みです」。
 */
export async function addWishlistItem(
  repo: ListItemsDeps,
  userId: string,
  listId: string,
  input: { spotId: string },
): Promise<{ itemCount: number }> {
  const list = await getOwnedWishlist(repo, userId, listId);
  const spot = await repo.spots.getById(input.spotId);
  if (!spot) throw ApiError.notFound(SPOT_NOT_FOUND_MESSAGE);
  // 既に入っているスポットは上限に関係なく「追加済み」を返す
  const already = list.items.some((i) => i.spotId === input.spotId);
  if (already) throw ApiError.conflict(ALREADY_ADDED_MESSAGE);
  if (list.itemCount >= LIMITS.itemsPerList) throw ApiError.conflict(ITEMS_LIMIT_MESSAGE);
  const res = await repo.wishlists.addItem(listId, input.spotId);
  if (!res.added) throw ApiError.conflict(ALREADY_ADDED_MESSAGE);
  return { itemCount: res.itemCount };
}

/** PATCH /lists/{listId}/items/{spotId}（F-4-4） */
export async function setWishlistItemMustVisit(
  repo: ListsDeps,
  userId: string,
  listId: string,
  spotId: string,
  input: { mustVisit: boolean },
): Promise<{ mustVisit: boolean }> {
  await getOwnedWishlist(repo, userId, listId);
  const ok = await repo.wishlists.setMustVisit(listId, spotId, input.mustVisit);
  if (!ok) throw ApiError.notFound(ITEM_NOT_FOUND_MESSAGE);
  return { mustVisit: input.mustVisit };
}

/** DELETE /lists/{listId}/items/{spotId} */
export async function removeWishlistItem(
  repo: ListsDeps,
  userId: string,
  listId: string,
  spotId: string,
): Promise<void> {
  await getOwnedWishlist(repo, userId, listId);
  const removed = await repo.wishlists.removeItem(listId, spotId);
  if (!removed) throw ApiError.notFound(ITEM_NOT_FOUND_MESSAGE);
}

/** POST /lists/{listId}/share（F-4-6）：既に発行済みなら同じトークンを返す */
export async function shareWishlist(
  repo: ListsDeps,
  userId: string,
  listId: string,
  siteUrl?: string,
): Promise<{ shareToken: string; url: string }> {
  const list = await getOwnedWishlist(repo, userId, listId);
  let token = list.shareToken;
  if (!token) {
    token = newShareToken();
    await repo.wishlists.setShareToken(listId, token);
  }
  return { shareToken: token, url: sharedListUrl(token, siteUrl) };
}

/** DELETE /lists/{listId}/share（F-4-6）：共有を停止する。未共有でも 204 */
export async function unshareWishlist(repo: ListsDeps, userId: string, listId: string): Promise<void> {
  await getOwnedWishlist(repo, userId, listId);
  await repo.wishlists.setShareToken(listId, null);
}

/** GET /shared/{token}（ログイン不要）：停止済み・不明なトークンは 404 */
export async function getSharedWishlist(repo: ListsDeps, token: string): Promise<SharedWishlist> {
  const shared = token ? await repo.wishlists.getByShareToken(token) : null;
  if (!shared) throw ApiError.notFound(SHARED_NOT_FOUND_MESSAGE);
  return shared;
}
