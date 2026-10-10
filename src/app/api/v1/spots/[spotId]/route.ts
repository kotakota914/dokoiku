/**
 * GET /api/v1/spots/{spotId}（F-3-1）
 * SpotDetail。無ければ 404「このスポットは見つかりませんでした」、ID が UUID でなければ 400。ログイン不要。
 */
import { json, route } from "@/lib/api/handler";
import { getRepo } from "@/lib/repo";
import { getSpotDetail } from "@/lib/services/spots";
import { uuidSchema } from "@/lib/validation/schemas";

export const GET = route<{ spotId: string }>(async (_req, { params }) => {
  const spotId = uuidSchema.parse((await params).spotId);
  const repo = await getRepo();
  return json(await getSpotDetail(repo, spotId));
});
