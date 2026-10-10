import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PlanForm } from "@/components/plan/PlanForm";
import { getCurrentUser } from "@/lib/auth/server";
import { loginUrl, welcomeUrl } from "@/lib/auth/next-path";
import { getRepo } from "@/lib/repo";

type Props = { params: Promise<{ listId: string }> };

export const metadata: Metadata = { title: "経路作成" };

/** S-08 経路作成（条件入力）。ログイン必須・本人のみ。無い／他人のものは 404 */
export default async function PlanCreatePage({ params }: Props) {
  const { listId } = await params;
  const path = `/lists/${encodeURIComponent(listId)}/plan`;
  const user = await getCurrentUser();
  if (!user) redirect(loginUrl(path));
  if (!user.profile) redirect(welcomeUrl(path));
  const repo = await getRepo();
  const list = await repo.wishlists.getById(listId);
  if (!list || list.userId !== user.id) notFound();
  return <PlanForm list={list} />;
}
