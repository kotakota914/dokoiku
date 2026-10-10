/**
 * GET /api/v1/shared/{token}（F-4-6）：共有リスト閲覧。ログイン不要。
 * SharedWishlist。停止済み・不明なトークンは 404「このリストは共有されていません」。
 */
import { json, route } from "@/lib/api/handler";
import { getRepo } from "@/lib/repo";
import { getSharedWishlist } from "@/lib/services/lists";

export const GET = route<{ token: string }>(async (_req, { params }) => {
  const { token } = await params;
  const repo = await getRepo();
  return json(await getSharedWishlist(repo, token));
});
