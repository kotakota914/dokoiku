/**
 * POST   /api/v1/lists/{listId}/share（F-4-6）：共有 URL 発行。{ shareToken, url }。発行済みなら同じトークン。
 * DELETE /api/v1/lists/{listId}/share（F-4-6）：共有停止。204。
 */
import { json, noContent, route } from "@/lib/api/handler";
import { requireProfile } from "@/lib/auth/server";
import { getRepo } from "@/lib/repo";
import { shareWishlist, unshareWishlist } from "@/lib/services/lists";
import { uuidSchema } from "@/lib/validation/schemas";

type Params = { listId: string };

export const POST = route<Params>(async (_req, { params }) => {
  const user = await requireProfile();
  const listId = uuidSchema.parse((await params).listId);
  const repo = await getRepo();
  return json(await shareWishlist(repo, user.id, listId));
});

export const DELETE = route<Params>(async (_req, { params }) => {
  const user = await requireProfile();
  const listId = uuidSchema.parse((await params).listId);
  const repo = await getRepo();
  await unshareWishlist(repo, user.id, listId);
  return noContent();
});
