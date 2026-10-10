/**
 * POST /api/v1/lists/{listId}/items（F-4-2）：スポット追加。201 { itemCount }。
 * スポットが無ければ 404、31 か所目は 409、重複は 409「追加済みです」。
 */
import { created, parseBody, route } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/server";
import { getRepo } from "@/lib/repo";
import { addWishlistItem } from "@/lib/services/lists";
import { addListItemSchema } from "@/lib/validation/schemas";

export const POST = route<{ listId: string }>(async (req, { params }) => {
  const user = await requireUser();
  const { listId } = await params;
  const input = await parseBody(req, addListItemSchema);
  const repo = await getRepo();
  return created(await addWishlistItem(repo, user.id, listId, input));
});
