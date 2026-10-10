/**
 * PATCH  /api/v1/lists/{listId}/items/{spotId}（F-4-4）：必ず行きたいの切り替え。{ mustVisit }。
 * DELETE /api/v1/lists/{listId}/items/{spotId}：スポット削除。204。リストに無ければ 404。
 */
import { z } from "zod";
import { json, noContent, parseBody, route } from "@/lib/api/handler";
import { requireProfile } from "@/lib/auth/server";
import { getRepo } from "@/lib/repo";
import { removeWishlistItem, setWishlistItemMustVisit } from "@/lib/services/lists";
import { setMustVisitSchema, uuidSchema } from "@/lib/validation/schemas";

type Params = { listId: string; spotId: string };

export const PATCH = route<Params>(async (req, { params }) => {
  const user = await requireProfile();
  const { listId, spotId } = z.object({ listId: uuidSchema, spotId: uuidSchema }).parse(await params);
  const input = await parseBody(req, setMustVisitSchema);
  const repo = await getRepo();
  return json(await setWishlistItemMustVisit(repo, user.id, listId, spotId, input));
});

export const DELETE = route<Params>(async (_req, { params }) => {
  const user = await requireProfile();
  const { listId, spotId } = z.object({ listId: uuidSchema, spotId: uuidSchema }).parse(await params);
  const repo = await getRepo();
  await removeWishlistItem(repo, user.id, listId, spotId);
  return noContent();
});
