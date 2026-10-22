import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CompareView, type CompareColumn } from "@/components/list/CompareView";
import { parseCompareSpotIds } from "@/components/list/listItems";
import { ApiError } from "@/lib/api/errors";
import { getCurrentUser } from "@/lib/auth/server";
import { loginUrl, welcomeUrl } from "@/lib/auth/next-path";
import { getRepo } from "@/lib/repo";
import { getSpotDetail } from "@/lib/services/spots";

type Props = {
  params: Promise<{ listId: string }>;
  searchParams: Promise<{ spots?: string | string[] }>;
};

export const metadata: Metadata = { title: "スポットを比較" };

function spotsQueryOf(sp: { spots?: string | string[] }): string {
  return Array.isArray(sp.spots) ? sp.spots.join(",") : (sp.spots ?? "");
}

/**
 * S-08 スポット比較（v0.3 F-4-10）：`?spots=a,b,c`（2〜3 件、リスト内のスポットのみ）。
 * ログイン必須・本人のみ。無い／他人のリストは 404。各スポットの詳細は GET /spots/{id} と同じ service から取る。
 * 削除されたスポットは列に「削除されました」と出す。
 */
export default async function ComparePage({ params, searchParams }: Props) {
  const { listId } = await params;
  const raw = spotsQueryOf(await searchParams);
  const path = `/lists/${encodeURIComponent(listId)}/compare${raw ? `?spots=${encodeURIComponent(raw)}` : ""}`;
  const user = await getCurrentUser();
  if (!user) redirect(loginUrl(path));
  if (!user.profile) redirect(welcomeUrl(path));
  const repo = await getRepo();
  const list = await repo.wishlists.getById(listId);
  if (!list || list.userId !== user.id) notFound();

  const spotIds = parseCompareSpotIds(
    raw,
    list.items.map((i) => i.spotId),
  );
  const columns: CompareColumn[] = await Promise.all(
    spotIds.map(async (spotId) => {
      try {
        return { spotId, spot: await getSpotDetail(repo, spotId) };
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return { spotId, spot: null };
        throw err;
      }
    }),
  );
  return <CompareView list={list} columns={columns} />;
}
