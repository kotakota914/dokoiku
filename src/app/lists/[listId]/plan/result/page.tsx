import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PlanResultPage } from "@/components/plan/PlanResultPage";
import { getCurrentUser } from "@/lib/auth/server";
import { loginUrl, welcomeUrl } from "@/lib/auth/next-path";

type Props = { params: Promise<{ listId: string }> };

export const metadata: Metadata = { title: "経路案の比較" };

/** S-11 経路案の比較（未保存）。ログイン確認だけ行い、結果はブラウザの sessionStorage から読む */
export default async function PlanResultRoute({ params }: Props) {
  const { listId } = await params;
  const path = `/lists/${encodeURIComponent(listId)}/plan/result`;
  const user = await getCurrentUser();
  if (!user) redirect(loginUrl(path));
  if (!user.profile) redirect(welcomeUrl(path));
  return <PlanResultPage listId={listId} />;
}
