/**
 * POST /api/v1/plans/recompute（F-5-6）：並び替え・滞在時間変更後の再計算。ログイン必須。
 * PlanResult。外部 API は呼ばない（移動時間はキャッシュ、無い区間は直線距離の概算）。
 */
import { json, parseBody, route } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/server";
import { getRepo } from "@/lib/repo";
import { recomputePlan } from "@/lib/services/plans";
import { planRecomputeSchema } from "@/lib/validation/schemas";

export const POST = route(async (req) => {
  const user = await requireUser();
  const input = await parseBody(req, planRecomputeSchema);
  const repo = await getRepo();
  return json(await recomputePlan(repo, user.id, input));
});
