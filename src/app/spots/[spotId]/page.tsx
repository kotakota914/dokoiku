import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/server";
import { LIMITS } from "@/lib/domain/constants";
import type { PostView, SpotDetail } from "@/lib/domain/types";
import { getRepo } from "@/lib/repo";
import { Badge, CategoryLabel, Icon, PageHeader, PopularityBadge, StayDurationLabel } from "@/components/ui";
import { HourHistogram } from "@/components/spot/HourHistogram";
import { PhotoGallery, type GalleryPhoto } from "@/components/spot/PhotoGallery";
import { PostList } from "@/components/spot/PostList";
import { SpotActions } from "@/components/spot/SpotActions";

type Props = { params: Promise<{ spotId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { spotId } = await params;
  const repo = await getRepo();
  const spot = await repo.spots.getById(spotId);
  if (!spot) return { title: "スポットが見つかりません" };
  return {
    title: spot.name,
    description: [spot.address, `投稿 ${spot.postCount} 件`].filter(Boolean).join(" / "),
  };
}

/** ギャラリーに出す写真：代表写真→投稿の写真（重複は除く） */
function collectPhotos(spot: SpotDetail, posts: PostView[]): GalleryPhoto[] {
  const photos: GalleryPhoto[] = [];
  const seen = new Set<string>();
  if (spot.coverFullUrl || spot.coverThumbUrl) {
    const key = spot.coverFullUrl ?? spot.coverThumbUrl ?? "";
    seen.add(key);
    photos.push({ id: `cover:${spot.id}`, thumbUrl: spot.coverThumbUrl, fullUrl: spot.coverFullUrl });
  }
  for (const post of posts) {
    if (post.status !== "public") continue;
    for (const img of [...post.images].sort((a, b) => a.sortOrder - b.sortOrder)) {
      if (seen.has(img.fullUrl)) continue;
      seen.add(img.fullUrl);
      photos.push({ id: img.id, thumbUrl: img.thumbUrl, fullUrl: img.fullUrl });
    }
  }
  return photos;
}

/** S-02 スポット詳細（F-3-1〜F-3-5、Q17） */
export default async function SpotDetailPage({ params }: Props) {
  const { spotId } = await params;
  const [repo, user] = await Promise.all([getRepo(), getCurrentUser()]);
  const spot = await repo.spots.getById(spotId);
  if (!spot) notFound();
  const viewerId = user?.id ?? null;
  const page = await repo.posts.listBySpot(spot.id, { limit: LIMITS.postsPageSize }, viewerId);
  const photos = collectPhotos(spot, page.items);
  const address = spot.address ?? [spot.prefecture, spot.city].filter(Boolean).join("");

  return (
    <div className="flex flex-1 flex-col bg-surface lg:bg-background">
      <PageHeader title={spot.name} backHref="/" className="lg:top-[var(--header-height)]" />
      <div className="mx-auto flex w-full max-w-[960px] flex-col gap-6 pb-8 lg:px-6 lg:pt-6">
        <section aria-label="写真" className="lg:rounded-card lg:border lg:border-border lg:bg-surface">
          <PhotoGallery photos={photos} spotName={spot.name} category={spot.category} />
        </section>

        <section className="flex flex-col gap-4 px-4 lg:rounded-card lg:border lg:border-border lg:bg-surface lg:p-6">
          <div className="flex flex-col gap-2">
            <p className="text-2xl font-bold text-text">{spot.name}</p>
            {address ? (
              <p className="flex items-start gap-1 text-base text-text-muted">
                <Icon name="map-pin" size={16} className="mt-1" />
                <span>{address}</span>
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Badge>
                <CategoryLabel category={spot.category} />
              </Badge>
              <PopularityBadge popularity={spot.popularity} />
            </div>
          </div>

          <dl className="grid grid-cols-3 gap-2 rounded-card border border-border bg-surface-muted p-3 text-center">
            <div className="flex flex-col">
              <dt className="text-sm text-text-muted">投稿数</dt>
              <dd className="inline-flex items-center justify-center gap-1 text-lg font-semibold text-text">
                <Icon name="camera" size={16} />
                {spot.postCount}
              </dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-sm text-text-muted">いいね合計</dt>
              <dd className="inline-flex items-center justify-center gap-1 text-lg font-semibold text-text">
                <Icon name="heart" size={16} />
                {spot.likeCount}
              </dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-sm text-text-muted">平均的な滞在時間</dt>
              <dd className="text-lg font-semibold text-text">
                <StayDurationLabel
                  minutes={spot.stayMinutesMedian}
                  emptyLabel="情報なし"
                  className="justify-center"
                />
              </dd>
            </div>
          </dl>

          <SpotActions spotId={spot.id} lat={spot.lat} lng={spot.lng} currentUserId={viewerId} />
        </section>

        <section className="flex flex-col gap-3 px-4 lg:rounded-card lg:border lg:border-border lg:bg-surface lg:p-6">
          <h2 className="text-lg font-semibold text-text">投稿が多い時間帯</h2>
          <HourHistogram histogram={spot.hourHistogram} />
        </section>

        <section className="flex flex-col gap-3 px-4 lg:px-0">
          <h2 className="text-lg font-semibold text-text">投稿一覧</h2>
          <PostList
            spotId={spot.id}
            initialPosts={page.items}
            initialCursor={page.nextCursor}
            currentUserId={viewerId}
          />
        </section>
      </div>
    </div>
  );
}
