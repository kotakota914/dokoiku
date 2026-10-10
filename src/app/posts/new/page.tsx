import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PostWizard } from "@/components/post/PostWizard";
import { getCurrentUser } from "@/lib/auth/server";
import { loginUrl, welcomeUrl } from "@/lib/auth/next-path";
import { getRepo } from "@/lib/repo";

export const metadata: Metadata = { title: "投稿する" };

type Props = { searchParams: Promise<{ spotId?: string }> };

/** S-04 投稿作成。未ログインならログイン画面へ（F-2-1）。?spotId= があれば初期選択にする */
export default async function NewPostPage({ searchParams }: Props) {
  const sp = await searchParams;
  const spotId = typeof sp.spotId === "string" && sp.spotId.length > 0 ? sp.spotId : null;
  const self = spotId ? `/posts/new?spotId=${encodeURIComponent(spotId)}` : "/posts/new";

  const user = await getCurrentUser();
  if (!user) redirect(loginUrl(self));
  if (!user.profile) redirect(welcomeUrl(self));

  let initialSpot: { id: string; name: string } | null = null;
  if (spotId) {
    const repo = await getRepo();
    const spot = await repo.spots.getById(spotId);
    if (spot) initialSpot = { id: spot.id, name: spot.name };
  }

  return <PostWizard initialSpot={initialSpot} />;
}
