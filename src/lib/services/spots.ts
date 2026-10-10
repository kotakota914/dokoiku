/**
 * スポット API の業務ロジック（F-1 / F-2-6 / F-3）。
 * Route Handler は「認証 → 入力検証 → ここを呼ぶ → レスポンス」だけを行う。
 * Repository の契約（src/lib/repo/types.ts）だけに依存し、"server-only" は import しない（vitest から直接テストするため）。
 */
import { ApiError } from "@/lib/api/errors";
import { LIMITS, MAP_ZOOM } from "@/lib/domain/constants";
import type {
  NearbyResponse,
  Page,
  PostView,
  SpotDetail,
  SpotSummary,
  SpotsInViewResponse,
} from "@/lib/domain/types";
import type { Paging, Repository } from "@/lib/repo/types";
import type { NearbyQuery, SpotSearchQuery, SpotsInViewQuery } from "@/lib/validation/schemas";

export const SPOT_NOT_FOUND_MESSAGE = "このスポットは見つかりませんでした";

type SpotsDeps = Pick<Repository, "spots">;

/**
 * GET /spots（9.3）：zoom が MAP_ZOOM.heatmapMax 以下ならヒートマップ用の点、それ以外はスポット一覧。
 * 1 回の返却は最大 LIMITS.mapMaxSpots 件（Repository が投稿数の多い順に切り詰める）。
 */
export async function getSpotsInView(repo: SpotsDeps, q: SpotsInViewQuery): Promise<SpotsInViewResponse> {
  const query = { bbox: q.bbox, categories: q.category, limit: LIMITS.mapMaxSpots };
  if (q.zoom <= MAP_ZOOM.heatmapMax) {
    const points = await repo.spots.heatmap(query);
    return { mode: "heatmap", points };
  }
  const spots = await repo.spots.inBbox(query);
  return { mode: "spots", spots };
}

/** GPS 誤差（メートル）から新規スポットを作れるかを判定する（Q7：100m 未満のときのみ） */
export function canCreateSpot(accuracyM: number): boolean {
  return accuracyM < LIMITS.gpsAccuracyMaxM;
}

/**
 * GET /spots/nearby（F-2-6）：現在地から radius 以内を近い順に最大 LIMITS.nearbyMax 件。
 * accuracy が省略された（誤差不明）ときは新規スポットを作れない（canCreate: false。Q7）。
 */
export async function getNearbySpots(repo: SpotsDeps, q: NearbyQuery): Promise<NearbyResponse> {
  const spots = await repo.spots.nearby({
    lat: q.lat,
    lng: q.lng,
    radiusM: q.radius,
    limit: LIMITS.nearbyMax,
  });
  return { canCreate: q.accuracy !== undefined && canCreateSpot(q.accuracy), spots };
}

/** GET /spots/search（F-3-6） */
export async function searchSpots(repo: SpotsDeps, q: SpotSearchQuery): Promise<Page<SpotSummary>> {
  return repo.spots.search({
    keyword: q.q || undefined,
    prefecture: q.prefecture || undefined,
    city: q.city || undefined,
    category: q.category,
    sort: q.sort,
    paging: { cursor: q.cursor, limit: q.limit },
  });
}

/** GET /spots/{spotId}：無ければ 404 */
export async function getSpotDetail(repo: SpotsDeps, spotId: string): Promise<SpotDetail> {
  const spot = await repo.spots.getById(spotId);
  if (!spot) throw ApiError.notFound(SPOT_NOT_FOUND_MESSAGE);
  return spot;
}

/**
 * GET /spots/{spotId}/posts（F-3-2）：新着順。viewerId が本人・管理者なら hidden も含む（Repository の判断）。
 * スポットが無ければ 404。
 */
export async function listSpotPosts(
  repo: Pick<Repository, "spots" | "posts">,
  spotId: string,
  paging: Paging,
  viewerId: string | null = null,
): Promise<Page<PostView>> {
  const spot = await repo.spots.getById(spotId);
  if (!spot) throw ApiError.notFound(SPOT_NOT_FOUND_MESSAGE);
  return repo.posts.listBySpot(spotId, paging, viewerId);
}
