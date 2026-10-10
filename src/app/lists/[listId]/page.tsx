import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ListDetail } from "@/components/list/ListDetail";
import { getCurrentUser } from "@/lib/auth/server";
import { loginUrl, welcomeUrl } from "@/lib/auth/next-path";
import { getRepo } from "@/lib/repo";

type Props = { params: Promise<{ listId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { listId } = await params;
  const user = await getCurrentUser();
  if (!user) return { title: "リスト" };
  const repo = await getRepo();
  const list = await repo.wishlists.getById(listId);
  if (!list || list.userId !== user.id) return { title: "リストが見つかりません" };
  return { title: list.name };
}

/** S-07 リスト詳細（F-4）。ログイン必須・本人のみ。無い／他人のものは 404 */
export default async function ListDetailPage({ params }: Props) {
  const { listId } = await params;
  const path = `/lists/${encodeURIComponent(listId)}`;
  const user = await getCurrentUser();
  if (!user) redirect(loginUrl(path));
  if (!user.profile) redirect(welcomeUrl(path));
  const repo = await getRepo();
  const list = await repo.wishlists.getById(listId);
  if (!list || list.userId !== user.id) notFound();
  return <ListDetail list={list} currentUserId={user.id} />;
}
