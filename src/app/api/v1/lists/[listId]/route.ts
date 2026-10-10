/**
 * GET    /api/v1/lists/{listId}（F-4）：WishlistDetail（スポット・保存済みプラン含む）。本人のみ。
 * PATCH  /api/v1/lists/{listId}（F-4-1）：名前変更。Wishlist。
 * DELETE /api/v1/lists/{listId}（F-4-1）：削除。204。
 * 他人のリストは 403、無ければ 404。
 */
import { json, noContent, parseBody, route } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/server";
import { getRepo } from "@/lib/repo";
import { deleteWishlist, getOwnedWishlist, renameWishlist } from "@/lib/services/lists";
import { renameListSchema } from "@/lib/validation/schemas";

type Params = { listId: string };

export const GET = route<Params>(async (_req, { params }) => {
  const user = await requireUser();
  const { listId } = await params;
  const repo = await getRepo();
  return json(await getOwnedWishlist(repo, user.id, listId));
});

export const PATCH = route<Params>(async (req, { params }) => {
  const user = await requireUser();
  const { listId } = await params;
  const input = await parseBody(req, renameListSchema);
  const repo = await getRepo();
  return json(await renameWishlist(repo, user.id, listId, input));
});

export const DELETE = route<Params>(async (_req, { params }) => {
  const user = await requireUser();
  const { listId } = await params;
  const repo = await getRepo();
  await deleteWishlist(repo, user.id, listId);
  return noContent();
});
