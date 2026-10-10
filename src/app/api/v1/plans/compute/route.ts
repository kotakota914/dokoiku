/**
 * POST /api/v1/plans/compute（F-5、11章）：経路プランの計算（保存しない）。ログイン必須。
 * PlanResult。停止中（F-8）は 503、リストに無いスポットは 400、他人のリストは 403。
 * 外部 API は最大 2 回（移動時間行列 1 回＋経路形状 1 回）。
 */
import { json, parseBody, route } from "@/lib/api/handler";
import { requireProfile } from "@/lib/auth/server";
import { getRepo } from "@/lib/repo";
import { computePlan } from "@/lib/services/plans";
import { planComputeSchema } from "@/lib/validation/schemas";

export const POST = route(async (req) => {
  const user = await requireProfile();
  const input = await parseBody(req, planComputeSchema);
  const repo = await getRepo();
  return json(await computePlan(repo, user.id, input));
});
