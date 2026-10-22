/**
 * POST /api/v1/plans/recompute（F-5-10）：並び替え・滞在時間変更後の再計算。ログイン必須。
 * PlanResult（1 案）。外部 API は呼ばない（移動時間はキャッシュ、無い区間は概算）。
 * candidate（id / kind / label）を渡すとその案を引き継ぐ。
 */
import { json, parseBody, route } from "@/lib/api/handler";
import { requireProfile } from "@/lib/auth/server";
import { getRepo } from "@/lib/repo";
import { recomputePlan } from "@/lib/services/plans";
import { planRecomputeSchema } from "@/lib/validation/schemas";

export const POST = route(async (req) => {
  const user = await requireProfile();
  const input = await parseBody(req, planRecomputeSchema);
  const repo = await getRepo();
  return json(await recomputePlan(repo, user.id, input));
});
