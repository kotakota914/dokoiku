/**
 * GET /api/v1/spots/{spotId}（F-3-1）
 * SpotDetail。無ければ 404「このスポットは見つかりませんでした」。ログイン不要。
 */
import { json, route } from "@/lib/api/handler";
import { getRepo } from "@/lib/repo";
import { getSpotDetail } from "@/lib/services/spots";

export const GET = route<{ spotId: string }>(async (_req, { params }) => {
  const { spotId } = await params;
  const repo = await getRepo();
  return json(await getSpotDetail(repo, spotId));
});
