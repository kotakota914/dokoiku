import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PlanChatPage } from "@/components/plan/PlanChat";
import { getCurrentUser } from "@/lib/auth/server";
import { loginUrl, welcomeUrl } from "@/lib/auth/next-path";
import { getRepo } from "@/lib/repo";

type Props = { params: Promise<{ listId: string }> };

export const metadata: Metadata = { title: "AIと相談" };

/** S-10 AIと相談。ログイン必須・本人のみ。無い／他人のものは 404。会話は保存しない */
export default async function PlanChatRoute({ params }: Props) {
  const { listId } = await params;
  const path = `/lists/${encodeURIComponent(listId)}/plan/chat`;
  const user = await getCurrentUser();
  if (!user) redirect(loginUrl(path));
  if (!user.profile) redirect(welcomeUrl(path));
  const repo = await getRepo();
  const list = await repo.wishlists.getById(listId);
  if (!list || list.userId !== user.id) notFound();
  return <PlanChatPage list={list} />;
}
