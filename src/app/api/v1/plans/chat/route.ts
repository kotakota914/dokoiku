/**
 * POST /api/v1/plans/chat（F-5-5 / ADR-0023）：AIと相談（会話から条件を読み取る）。ログイン必須。
 * PlanChatResponse（reply / conditions / unclear）。会話は保存しない。
 * - 1 分に 5 回まで（ユーザーごと。超過は 429 RATE_LIMITED）
 * - AI が停止中・未設定なら 503 FEATURE_SUSPENDED（details.feature: ai_chat）
 * - リストに無いスポットは 400、他人のリストは 403
 */
import { json, parseBody, route } from "@/lib/api/handler";
import { requireProfile } from "@/lib/auth/server";
import { getRepo } from "@/lib/repo";
import { assertChatRateLimit, chatPlan } from "@/lib/services/plans";
import { planChatSchema } from "@/lib/validation/schemas";

export const POST = route(async (req) => {
  const user = await requireProfile();
  assertChatRateLimit(user.id);
  const input = await parseBody(req, planChatSchema);
  const repo = await getRepo();
  return json(await chatPlan(repo, user.id, input));
});
