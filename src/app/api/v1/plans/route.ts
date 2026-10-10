/**
 * POST /api/v1/plans（F-5-7）：経路プランの保存。ログイン必須。201 Plan。
 * リストは本人のもの（他人なら 403、無ければ 404）。
 */
import { created, parseBody, route } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/server";
import { getRepo } from "@/lib/repo";
import { savePlan } from "@/lib/services/plans";
import { planSaveSchema } from "@/lib/validation/schemas";

export const POST = route(async (req) => {
  const user = await requireUser();
  const input = await parseBody(req, planSaveSchema);
  const repo = await getRepo();
  return created(await savePlan(repo, user.id, input));
});
