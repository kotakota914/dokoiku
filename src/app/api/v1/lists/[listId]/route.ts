/**
 * GET    /api/v1/lists/{listId}（F-4）：WishlistDetail（スポット・拠点・保存済みプラン含む）。本人のみ。
 * PATCH  /api/v1/lists/{listId}（F-4-1 / v0.3 F-4-8）：名前変更・拠点の設定（base: null で解除）。Wishlist。
 *        name だけの PATCH（v0.1 互換）も動く。外部 API は呼ばない。
 * DELETE /api/v1/lists/{listId}（F-4-1）：削除。204。
 * 他人のリストは 403、無ければ 404、ID が UUID でなければ 400。プロフィール未作成は 403。
 */
import { json, noContent, parseBody, route } from "@/lib/api/handler";
import { requireProfile } from "@/lib/auth/server";
import { getRepo } from "@/lib/repo";
import { deleteWishlist, getOwnedWishlist, updateWishlist } from "@/lib/services/lists";
import { updateListSchema, uuidSchema } from "@/lib/validation/schemas";

type Params = { listId: string };

export const GET = route<Params>(async (_req, { params }) => {
  const user = await requireProfile();
  const listId = uuidSchema.parse((await params).listId);
  const repo = await getRepo();
  return json(await getOwnedWishlist(repo, user.id, listId));
});

export const PATCH = route<Params>(async (req, { params }) => {
  const user = await requireProfile();
  const listId = uuidSchema.parse((await params).listId);
  const input = await parseBody(req, updateListSchema);
  const repo = await getRepo();
  return json(await updateWishlist(repo, user.id, listId, input));
});

export const DELETE = route<Params>(async (_req, { params }) => {
  const user = await requireProfile();
  const listId = uuidSchema.parse((await params).listId);
  const repo = await getRepo();
  await deleteWishlist(repo, user.id, listId);
  return noContent();
});
