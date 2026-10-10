import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ListIndex } from "@/components/list/ListIndex";
import { getCurrentUser } from "@/lib/auth/server";
import { loginUrl, welcomeUrl } from "@/lib/auth/next-path";
import { getRepo } from "@/lib/repo";

export const metadata: Metadata = { title: "行きたい場所リスト" };

/** S-06 リスト一覧（F-4-1）。ログイン必須：未ログインは /login?next=/lists */
export default async function ListsPage() {
  const user = await getCurrentUser();
  if (!user) redirect(loginUrl("/lists"));
  if (!user.profile) redirect(welcomeUrl("/lists"));
  const repo = await getRepo();
  const lists = await repo.wishlists.listByUser(user.id);
  return <ListIndex lists={lists} />;
}
