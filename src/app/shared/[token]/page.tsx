import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SharedListView } from "@/components/list/SharedListView";
import { getRepo } from "@/lib/repo";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const repo = await getRepo();
  const list = await repo.wishlists.getByShareToken(token);
  if (!list) return { title: "このリストは共有されていません" };
  return {
    title: `${list.name}（共有リスト）`,
    description: `${list.ownerDisplayName}さんの行きたい場所リスト`,
  };
}

/** S-10 共有リスト（F-4-6）。ログイン不要・閲覧のみ。停止済み／不明な token は not-found */
export default async function SharedListPage({ params }: Props) {
  const { token } = await params;
  const repo = await getRepo();
  const list = await repo.wishlists.getByShareToken(token);
  if (!list) notFound();
  return <SharedListView token={token} list={list} />;
}
