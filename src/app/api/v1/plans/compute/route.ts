/**
 * POST /api/v1/plans/compute（F-5、11章）：経路案の作成（保存しない、最大 3 案）。ログイン必須。
 * PlanComputeResponse（candidates / travelMatrixId / skipped）。1 案も入らなければ 200 で candidates: []。
 * - 1 分に 3 回まで（ユーザーごと。超過は 429 RATE_LIMITED）
 * - 移動手段の機能が停止中なら 503 FEATURE_SUSPENDED（details.feature: route_planning / route_planning_transit）
 * - リストに無いスポットは 400、他人のリストは 403。外部 API は移動時間の行列 1 回まで。
 */
import { json, parseBody, route } from "@/lib/api/handler";
import { requireProfile } from "@/lib/auth/server";
import { getRepo } from "@/lib/repo";
import { assertPlanRateLimit, computePlan } from "@/lib/services/plans";
import { planComputeSchema } from "@/lib/validation/schemas";

export const POST = route(async (req) => {
  const user = await requireProfile();
  assertPlanRateLimit(user.id);
  const input = await parseBody(req, planComputeSchema);
  const repo = await getRepo();
  return json(await computePlan(repo, user.id, input));
});
