/**
 * GET    /api/v1/plans/{planId}（F-5-7）：保存済みプラン。本人のみ。Plan。
 * DELETE /api/v1/plans/{planId}（F-5-7）：プラン削除。204。
 * 他人のプランは 403、無ければ 404、ID が UUID でなければ 400。
 */
import { json, noContent, route } from "@/lib/api/handler";
import { requireProfile } from "@/lib/auth/server";
import { getRepo } from "@/lib/repo";
import { deletePlan, getPlan } from "@/lib/services/plans";
import { uuidSchema } from "@/lib/validation/schemas";

type Params = { planId: string };

export const GET = route<Params>(async (_req, { params }) => {
  const user = await requireProfile();
  const planId = uuidSchema.parse((await params).planId);
  const repo = await getRepo();
  return json(await getPlan(repo, user.id, planId));
});

export const DELETE = route<Params>(async (_req, { params }) => {
  const user = await requireProfile();
  const planId = uuidSchema.parse((await params).planId);
  const repo = await getRepo();
  await deletePlan(repo, user.id, planId);
  return noContent();
});
