import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PlanResultView } from "@/components/plan/PlanResultView";
import { getCurrentUser } from "@/lib/auth/server";
import { loginUrl, welcomeUrl } from "@/lib/auth/next-path";
import { pageOpenGraph } from "@/lib/og/metadata";
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

/** S-09 保存済みプラン（F-5-7）。ログイン必須・本人のみ。無い／他人のものは 404 */
export default async function SavedPlanPage({ params }: Props) {
  const { planId } = await params;
  const path = `/plans/${encodeURIComponent(planId)}`;
  const user = await getCurrentUser();
  if (!user) redirect(loginUrl(path));
  if (!user.profile) redirect(welcomeUrl(path));
  const repo = await getRepo();
  const plan = await repo.plans.getById(planId);
  if (!plan || plan.userId !== user.id) notFound();
  const spots = await repo.spots.getManyByIds(plan.params.spotIds);
  return (
    <PlanResultView
      params={plan.params}
      result={plan.result}
      spots={spots}
      listId={plan.wishlistId}
      saved={{ planId: plan.id }}
    />
  );
}
