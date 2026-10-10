/**
 * GET  /api/v1/lists（F-4）：自分のリスト一覧 { lists: Wishlist[] }。ログイン必須。
 * POST /api/v1/lists（F-4-1）：リスト作成。201 Wishlist。21 件目は 409。
 */
import { created, json, parseBody, route } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/server";
import { getRepo } from "@/lib/repo";
import { createWishlist, listWishlists } from "@/lib/services/lists";
import { createListSchema } from "@/lib/validation/schemas";

export const GET = route(async () => {
  const user = await requireUser();
  const repo = await getRepo();
  return json(await listWishlists(repo, user.id));
});

export const POST = route(async (req) => {
  const user = await requireUser();
  const input = await parseBody(req, createListSchema);
  const repo = await getRepo();
  return created(await createWishlist(repo, user.id, input));
});
