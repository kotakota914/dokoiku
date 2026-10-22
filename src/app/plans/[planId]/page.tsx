import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PlanResultView } from "@/components/plan/PlanResultView";
import { getCurrentUser } from "@/lib/auth/server";
import { loginUrl, welcomeUrl } from "@/lib/auth/next-path";
import { pageOpenGraph } from "@/lib/og/metadata";
import type { PlanWithNav } from "@/lib/domain/types";
import { getPlan } from "@/lib/services/plans";
import { getRepo } from "@/lib/repo";
import { formatDateJa } from "@/lib/utils/time";

type Props = { params: Promise<{ planId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { planId } = await params;
  const user = await getCurrentUser();
  if (!user) return { title: "経路プラン" };
  const repo = await getRepo();
  const plan = await repo.plans.getById(planId);
  if (!plan || plan.userId !== user.id) return { title: "プランが見つかりません" };
  const title = `${formatDateJa(plan.date)}のプラン`;
  const description = `${plan.spotCount}か所を回る経路プラン`;
  return {
    title,
    description,
    openGraph: pageOpenGraph({ title, description, url: `/plans/${encodeURIComponent(plan.id)}` }),
  };
}

/**
 * S-12 経路プラン（保存済み）。ログイン必須・本人のみ。無い／他人のものは 404。
 * 各区間の「ナビを開始」は segments（GET /plans/{planId} と同じ形）を使い、無ければ画面側で作る。
 */
export default async function SavedPlanPage({ params }: Props) {
  const { planId } = await params;
  const path = `/plans/${encodeURIComponent(planId)}`;
  const user = await getCurrentUser();
  if (!user) redirect(loginUrl(path));
  if (!user.profile) redirect(welcomeUrl(path));
  const repo = await getRepo();
  const owned = await repo.plans.getById(planId);
  if (!owned || owned.userId !== user.id) notFound();
  // GET /plans/{planId} と同じ組み立て（各区間の「ナビを開始」URL を含む）
  const plan: PlanWithNav = await getPlan(repo, user.id, planId);
  const spots = await repo.spots.getManyByIds(plan.params.spotIds);
  const navSegments = plan.segments;
  return <PlanResultView plan={plan} spots={spots} navSegments={navSegments} />;
}
