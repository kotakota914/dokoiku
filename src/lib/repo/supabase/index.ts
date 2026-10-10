import "server-only";
/**
 * Supabase 実装の Repository。
 * - ユーザー操作（spots / posts / likes / wishlists / plans / profiles）は Cookie セッションのクライアント（RLS 適用）。
 * - サーバー専用の処理（apiUsage / reports / travelCache / storage / 共有リスト閲覧 / 退会 / setStatus / 統計更新）は
 *   service role のクライアント。
 * - クライアントは最初に使うときに作る。cookies() が使えない文脈（cron など）では admin クライアントで代替する。
 * - 権限（本人かどうか）は API 側で確認する。ここでは RLS が二重の守りになるだけで、判定はしない。
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { LIMITS, STORAGE_BUCKET } from "@/lib/domain/constants";
import type { Category, Feature, TravelMode } from "@/lib/domain/types-reexport";
import type {
  ApiUsage,
  HeatPoint,
  NearbySpot,
  Page,
  Plan,
  PlanParams,
  PlanResult,
  PlanSummary,
  PostImage,
  PostView,
  Profile,
  Report,
  SharedWishlist,
  Spot,
  SpotDetail,
  SpotSummary,
  SuspendedFeature,
  TravelTimeEntry,
  UploadRequestFile,
  UploadTarget,
  Wishlist,
  WishlistDetail,
  WishlistItem,
} from "@/lib/domain/types";
import type {
  ApiUsageRepo,
  Bbox,
  LikesRepo,
  Paging,
  PlansRepo,
  PostsRepo,
  ProfilesRepo,
  Repository,
  ReportsRepo,
  SpotsRepo,
  StorageRepo,
  TravelCacheRepo,
  WishlistsRepo,
} from "@/lib/repo/types";
import { serverConfig } from "@/lib/config";
import { decodeCursor, encodeCursor } from "@/lib/api/cursor";
import { newId } from "@/lib/utils/id";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  decodeSearchCursorValue,
  encodeSearchCursorValue,
  mapApiUsage,
  mapHeatRow,
  mapNearbyRow,
  mapPlan,
  mapPlanSummary,
  mapPostView,
  mapProfile,
  mapReport,
  mapSpot,
  mapSpotSummaryRow,
  mapSuspended,
  mapTravelTime,
  mapWishlist,
  quoteFilterValue,
  spotToDetail,
  spotToSummary,
  toEwkt,
  toNumber,
  type ApiUsageRow,
  type HeatRow,
  type NearbyRow,
  type PlanRow,
  type PostImageRow,
  type PostJoinedRow,
  type PostRow,
  type ProfileRow,
  type PublicUrlFn,
  type ReportRow,
  type SpotRow,
  type SpotSearchRow,
  type SpotSummaryRow,
  type TravelTimeCacheRow,
  type WishlistItemRow,
  type WishlistRow,
} from "./mappers";

type Client = SupabaseClient;

/** PostgREST / Storage の応答。error があれば例外にする */
interface Result<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

function unwrap<T>(res: Result<T>, context: string): T {
  if (res.error) throw new Error(`${context}: ${res.error.message}`);
  if (res.data == null) throw new Error(`${context}: データがありません`);
  return res.data;
}

function unwrapNullable<T>(res: Result<T>, context: string): T | null {
  if (res.error) throw new Error(`${context}: ${res.error.message}`);
  return res.data;
}

/** 一意制約違反（重複）か */
function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

const POSTS = "posts";

/** 投稿一覧で埋め込む列 */
const POST_SELECT = "*, post_images(*), profiles(id, display_name, avatar_url), spots(name)";

/** PostgREST の `.or()` に渡す created_at / id のキーセット条件（新着順） */
function keysetOlderThan(createdAt: string, id: string): string {
  const c = quoteFilterValue(createdAt);
  const i = quoteFilterValue(id);
  return `created_at.lt.${c},and(created_at.eq.${c},id.lt.${i})`;
}

/**
 * クライアントの遅延生成。
 * user: Cookie セッション（RLS 適用）。cookies() が使えなければ admin で代替する。
 */
class Clients {
  private userPromise: Promise<{ client: Client; viaAdmin: boolean }> | null = null;
  private adminClient: Client | null = null;

  admin(): Client {
    if (!this.adminClient) this.adminClient = createSupabaseAdminClient();
    return this.adminClient;
  }

  user(): Promise<{ client: Client; viaAdmin: boolean }> {
    if (!this.userPromise) {
      this.userPromise = (async () => {
        try {
          const { createSupabaseServerClient } = await import("@/lib/supabase/server");
          const client = await createSupabaseServerClient();
          return { client: client as unknown as Client, viaAdmin: false };
        } catch {
          // Route Handler / Server Component の外（cron など）では cookies() が使えない
          return { client: this.admin(), viaAdmin: true };
        }
      })();
    }
    return this.userPromise;
  }

  /** 公開 URL（Storage はネットワークを使わず URL を組み立てるだけ） */
  publicUrl(path: string): string {
    try {
      return this.admin().storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl;
    } catch {
      const base = (serverConfig.supabaseUrl ?? "").replace(/\/$/, "");
      return `${base}/storage/v1/object/public/${STORAGE_BUCKET}/${path}`;
    }
  }
}

// ---------- profiles ----------
class SupabaseProfilesRepo implements ProfilesRepo {
  constructor(private readonly clients: Clients) {}

  async getById(id: string): Promise<Profile | null> {
    const { client } = await this.clients.user();
    const row = unwrapNullable<ProfileRow>(
      await client.from("profiles").select("*").eq("id", id).maybeSingle(),
      "profiles.getById",
    );
    return row ? mapProfile(row) : null;
  }

  async create(input: { id: string; displayName: string; avatarUrl?: string | null }): Promise<Profile> {
    const existing = await this.getById(input.id);
    if (existing) return existing;
    const { client } = await this.clients.user();
    const row = unwrap<ProfileRow>(
      await client
        .from("profiles")
        .insert({ id: input.id, display_name: input.displayName, avatar_url: input.avatarUrl ?? null })
        .select("*")
        .single(),
      "profiles.create",
    );
    return mapProfile(row);
  }

  async update(id: string, patch: { displayName?: string; avatarUrl?: string | null }): Promise<Profile> {
    const { client } = await this.clients.user();
    const values: Record<string, string | null> = {};
    if (patch.displayName !== undefined) values.display_name = patch.displayName;
    if (patch.avatarUrl !== undefined) values.avatar_url = patch.avatarUrl;
    if (Object.keys(values).length === 0) {
      const current = await this.getById(id);
      if (!current) throw new Error("profiles.update: プロフィールが見つかりません");
      return current;
    }
    const row = unwrap<ProfileRow>(
      await client.from("profiles").update(values).eq("id", id).select("*").single(),
      "profiles.update",
    );
    return mapProfile(row);
  }

  async deleteAccount(id: string): Promise<{ deletedImagePaths: string[] }> {
    const admin = this.clients.admin();
    // 退会前に、本人の投稿と影響するスポット（あとで統計を更新する）を集める
    const postRows = unwrapNullable<{ id: string; spot_id: string }[]>(
      await admin.from("posts").select("id, spot_id").eq("user_id", id),
      "profiles.deleteAccount.posts",
    );
    const postIds = (postRows ?? []).map((r) => r.id);
    const spotIds = Array.from(new Set((postRows ?? []).map((r) => r.spot_id)));
    // 削除対象の写真パス（Storage から消すのは API 側）
    let deletedImagePaths: string[] = [];
    if (postIds.length > 0) {
      const images = unwrapNullable<Pick<PostImageRow, "full_path" | "thumb_path">[]>(
        await admin.from("post_images").select("full_path, thumb_path").in("post_id", postIds),
        "profiles.deleteAccount.images",
      );
      deletedImagePaths = (images ?? []).flatMap((img) => [img.full_path, img.thumb_path]);
    }
    // 投稿（画像・いいね・通報は cascade）、いいね、リスト（項目・プランは cascade）、プラン、通報、プロフィール
    unwrapNullable(await admin.from("posts").delete().eq("user_id", id), "profiles.deleteAccount.posts");
    unwrapNullable(await admin.from("likes").delete().eq("user_id", id), "profiles.deleteAccount.likes");
    unwrapNullable(await admin.from("plans").delete().eq("user_id", id), "profiles.deleteAccount.plans");
    unwrapNullable(
      await admin.from("wishlists").delete().eq("user_id", id),
      "profiles.deleteAccount.wishlists",
    );
    unwrapNullable(
      await admin.from("reports").delete().eq("reporter_id", id),
      "profiles.deleteAccount.reports",
    );
    unwrapNullable(await admin.from("profiles").delete().eq("id", id), "profiles.deleteAccount.profile");
    for (const spotId of spotIds) {
      unwrapNullable(
        await admin.rpc("recompute_spot_stats", { p_spot_id: spotId }),
        "profiles.deleteAccount.recompute",
      );
    }
    // 最後に認証ユーザーを消す
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error && error.status !== 404) throw new Error(`profiles.deleteAccount.auth: ${error.message}`);
    return { deletedImagePaths };
  }
}

// ---------- spots ----------
class SupabaseSpotsRepo implements SpotsRepo {
  constructor(
    private readonly clients: Clients,
    private readonly publicUrl: PublicUrlFn,
  ) {}

  private bboxArgs(bbox: Bbox, categories: Category[] | undefined, limit: number) {
    return {
      min_lng: bbox.minLng,
      min_lat: bbox.minLat,
      max_lng: bbox.maxLng,
      max_lat: bbox.maxLat,
      categories: categories && categories.length > 0 ? categories : null,
      max_count: Math.min(Math.max(limit, 1), LIMITS.mapMaxSpots),
    };
  }

  async inBbox(q: { bbox: Bbox; categories?: Category[]; limit: number }): Promise<SpotSummary[]> {
    const { client } = await this.clients.user();
    const rows = unwrapNullable<SpotSummaryRow[]>(
      await client.rpc("spots_in_bbox", this.bboxArgs(q.bbox, q.categories, q.limit)),
      "spots.inBbox",
    );
    return (rows ?? []).map((r) => mapSpotSummaryRow(r, this.publicUrl));
  }

  async heatmap(q: { bbox: Bbox; categories?: Category[]; limit: number }): Promise<HeatPoint[]> {
    const { client } = await this.clients.user();
    const rows = unwrapNullable<HeatRow[]>(
      await client.rpc("spots_heatmap", this.bboxArgs(q.bbox, q.categories, q.limit)),
      "spots.heatmap",
    );
    return (rows ?? []).map(mapHeatRow);
  }

  async nearby(q: { lat: number; lng: number; radiusM: number; limit: number }): Promise<NearbySpot[]> {
    const { client } = await this.clients.user();
    const rows = unwrapNullable<NearbyRow[]>(
      await client.rpc("spots_nearby", {
        p_lat: q.lat,
        p_lng: q.lng,
        radius_m: q.radiusM,
        max_count: q.limit,
      }),
      "spots.nearby",
    );
    return (rows ?? []).map((r) => mapNearbyRow(r, this.publicUrl));
  }

  async search(q: {
    keyword?: string;
    prefecture?: string;
    city?: string;
    category?: Category;
    sort: "popular" | "newest";
    paging: Paging;
  }): Promise<Page<SpotSummary>> {
    const { client } = await this.clients.user();
    const cursor = decodeCursor(q.paging.cursor);
    const cursorValue = cursor ? decodeSearchCursorValue(cursor.createdAt) : null;
    const limit = Math.max(1, q.paging.limit);
    const rows = unwrapNullable<SpotSearchRow[]>(
      await client.rpc("spots_search", {
        p_keyword: q.keyword?.trim() || null,
        p_prefecture: q.prefecture?.trim() || null,
        p_city: q.city?.trim() || null,
        p_category: q.category ?? null,
        p_sort: q.sort,
        p_limit: limit + 1,
        p_cursor_score: cursorValue?.score ?? null,
        p_cursor_created_at: cursorValue?.createdAt ?? null,
        p_cursor_id: cursor?.id ?? null,
      }),
      "spots.search",
    );
    const all = rows ?? [];
    const pageRows = all.slice(0, limit);
    const last = pageRows[pageRows.length - 1];
    const nextCursor =
      all.length > limit && last
        ? encodeCursor({
            createdAt: encodeSearchCursorValue(toNumber(last.score), last.created_at),
            id: last.id,
          })
        : null;
    return { items: pageRows.map((r) => mapSpotSummaryRow(r, this.publicUrl)), nextCursor };
  }

  /** cover_image_id → サムネイル・本画像のパス */
  private async coverPaths(
    client: Client,
    coverIds: string[],
  ): Promise<Map<string, { full_path: string; thumb_path: string }>> {
    const map = new Map<string, { full_path: string; thumb_path: string }>();
    const ids = Array.from(new Set(coverIds.filter(Boolean)));
    if (ids.length === 0) return map;
    const rows = unwrapNullable<{ id: string; full_path: string; thumb_path: string }[]>(
      await client.from("post_images").select("id, full_path, thumb_path").in("id", ids),
      "spots.coverPaths",
    );
    for (const r of rows ?? []) map.set(r.id, { full_path: r.full_path, thumb_path: r.thumb_path });
    return map;
  }

  /** spots テーブルの行を要約へ（代表写真を一括で引く） */
  private async summarize(client: Client, rows: SpotRow[]): Promise<SpotSummary[]> {
    const spots = rows.map(mapSpot);
    const covers = await this.coverPaths(client, spots.map((s) => s.coverImageId ?? "").filter(Boolean));
    return spots.map((s) =>
      spotToSummary(
        s,
        s.coverImageId ? (covers.get(s.coverImageId)?.thumb_path ?? null) : null,
        this.publicUrl,
      ),
    );
  }

  async getById(id: string): Promise<SpotDetail | null> {
    const { client } = await this.clients.user();
    const row = unwrapNullable<SpotRow>(
      await client.from("spots").select("*").eq("id", id).maybeSingle(),
      "spots.getById",
    );
    if (!row) return null;
    const spot = mapSpot(row);
    const covers = await this.coverPaths(client, spot.coverImageId ? [spot.coverImageId] : []);
    return spotToDetail(
      spot,
      spot.coverImageId ? (covers.get(spot.coverImageId) ?? null) : null,
      this.publicUrl,
    );
  }

  async getManyByIds(ids: string[]): Promise<SpotSummary[]> {
    const unique = Array.from(new Set(ids));
    if (unique.length === 0) return [];
    const { client } = await this.clients.user();
    const rows = unwrapNullable<SpotRow[]>(
      await client.from("spots").select("*").in("id", unique),
      "spots.getManyByIds",
    );
    const summaries = await this.summarize(client, rows ?? []);
    // 引数の順序を保つ
    const byId = new Map(summaries.map((s) => [s.id, s]));
    return unique.flatMap((id) => {
      const s = byId.get(id);
      return s ? [s] : [];
    });
  }

  async findSimilarName(q: {
    name: string;
    lat: number;
    lng: number;
    radiusM: number;
  }): Promise<SpotSummary[]> {
    const { client } = await this.clients.user();
    const rows = unwrapNullable<SpotRow[]>(
      await client.rpc("spots_similar_name", {
        p_name: q.name,
        p_lat: q.lat,
        p_lng: q.lng,
        radius_m: q.radiusM,
      }),
      "spots.findSimilarName",
    );
    return this.summarize(client, rows ?? []);
  }

  async create(input: {
    name: string;
    lat: number;
    lng: number;
    category: Category;
    source: Spot["source"];
    externalRef?: string | null;
    address?: string | null;
    prefecture?: string | null;
    city?: string | null;
    createdBy: string;
  }): Promise<Spot> {
    const { client } = await this.clients.user();
    const row = unwrap<SpotRow>(
      await client
        .from("spots")
        .insert({
          name: input.name,
          location: toEwkt(input),
          category: input.category,
          source: input.source,
          external_ref: input.externalRef ?? null,
          address: input.address ?? null,
          prefecture: input.prefecture ?? null,
          city: input.city ?? null,
          created_by: input.createdBy,
        })
        .select("*")
        .single(),
      "spots.create",
    );
    return mapSpot(row);
  }

  async recomputeStats(spotId: string): Promise<void> {
    // 統計更新はサーバー専用の処理として service role で行う（関数は security definer）
    unwrapNullable(
      await this.clients.admin().rpc("recompute_spot_stats", { p_spot_id: spotId }),
      "spots.recomputeStats",
    );
  }
}

// ---------- posts ----------
class SupabasePostsRepo implements PostsRepo {
  constructor(
    private readonly clients: Clients,
    private readonly publicUrl: PublicUrlFn,
  ) {}

  /** 閲覧者がいいね済みの投稿 ID */
  private async likedSet(
    client: Client,
    viewerId: string | null | undefined,
    postIds: string[],
  ): Promise<Set<string>> {
    if (!viewerId || postIds.length === 0) return new Set();
    const rows = unwrapNullable<{ post_id: string }[]>(
      await client.from("likes").select("post_id").eq("user_id", viewerId).in("post_id", postIds),
      "posts.likedSet",
    );
    return new Set((rows ?? []).map((r) => r.post_id));
  }

  /** 行の配列を PostView に変換する（likedByMe を付ける） */
  async toViews(
    client: Client,
    rows: PostJoinedRow[],
    viewerId: string | null | undefined,
  ): Promise<PostView[]> {
    const liked = await this.likedSet(
      client,
      viewerId,
      rows.map((r) => r.id),
    );
    return rows.map((r) => mapPostView(r, this.publicUrl, liked.has(r.id)));
  }

  /**
   * 投稿一覧の共通処理。RLS が「public または本人または管理者」を適用する。
   * cookies() が使えず admin で代替しているときだけ、明示的に同じ条件で絞る。
   */
  private async listWhere(
    column: "spot_id" | "user_id",
    value: string,
    paging: Paging,
    viewerId: string | null | undefined,
  ): Promise<Page<PostView>> {
    const { client, viaAdmin } = await this.clients.user();
    const limit = Math.max(1, paging.limit);
    let query = client.from(POSTS).select(POST_SELECT).eq(column, value);
    if (viaAdmin) {
      query = viewerId
        ? query.or(`status.eq.public,user_id.eq.${quoteFilterValue(viewerId)}`)
        : query.eq("status", "public");
    }
    const cursor = decodeCursor(paging.cursor);
    if (cursor) query = query.or(keysetOlderThan(cursor.createdAt, cursor.id));
    const rows = unwrapNullable<PostJoinedRow[]>(
      await query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit + 1),
      "posts.list",
    );
    const all = rows ?? [];
    const pageRows = all.slice(0, limit);
    const last = pageRows[pageRows.length - 1];
    const nextCursor =
      all.length > limit && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null;
    return { items: await this.toViews(client, pageRows, viewerId), nextCursor };
  }

  listBySpot(spotId: string, paging: Paging, viewerId?: string | null): Promise<Page<PostView>> {
    return this.listWhere("spot_id", spotId, paging, viewerId);
  }

  listByUser(userId: string, paging: Paging, viewerId?: string | null): Promise<Page<PostView>> {
    return this.listWhere("user_id", userId, paging, viewerId);
  }

  /** 指定クライアントで 1 件取得（通報一覧は admin から呼ぶ） */
  async getByIdWith(client: Client, id: string, viewerId?: string | null): Promise<PostView | null> {
    const row = unwrapNullable<PostJoinedRow>(
      await client.from(POSTS).select(POST_SELECT).eq("id", id).maybeSingle(),
      "posts.getById",
    );
    if (!row) return null;
    const [view] = await this.toViews(client, [row], viewerId);
    return view ?? null;
  }

  async getById(id: string, viewerId?: string | null): Promise<PostView | null> {
    const { client } = await this.clients.user();
    return this.getByIdWith(client, id, viewerId);
  }

  private async insertImages(client: Client, postId: string, images: Omit<PostImage, "id">[]): Promise<void> {
    if (images.length === 0) return;
    const values = images.map((img, i) => ({
      post_id: postId,
      full_path: img.fullPath,
      thumb_path: img.thumbPath,
      width: img.width,
      height: img.height,
      sort_order: img.sortOrder ?? i,
    }));
    unwrapNullable(await client.from("post_images").insert(values), "posts.insertImages");
  }

  async create(input: {
    userId: string;
    spotId: string;
    comment: string;
    category: Category;
    stayDuration: PostRow["stay_duration"];
    images: Omit<PostImage, "id">[];
  }): Promise<PostView> {
    const { client } = await this.clients.user();
    const row = unwrap<PostRow>(
      await client
        .from(POSTS)
        .insert({
          user_id: input.userId,
          spot_id: input.spotId,
          comment: input.comment,
          category: input.category,
          stay_duration: input.stayDuration,
          status: "public",
        })
        .select("*")
        .single(),
      "posts.create",
    );
    try {
      await this.insertImages(client, row.id, input.images);
    } catch (e) {
      // 画像の登録に失敗したら投稿も残さない
      await client.from(POSTS).delete().eq("id", row.id);
      throw e;
    }
    const view = await this.getByIdWith(client, row.id, input.userId);
    if (!view) throw new Error("posts.create: 作成した投稿を取得できません");
    return view;
  }

  async update(
    id: string,
    patch: {
      comment?: string;
      category?: Category;
      stayDuration?: PostRow["stay_duration"];
      images?: Omit<PostImage, "id">[];
    },
  ): Promise<PostView> {
    const { client } = await this.clients.user();
    const values: Record<string, string | null> = {};
    if (patch.comment !== undefined) values.comment = patch.comment;
    if (patch.category !== undefined) values.category = patch.category;
    if (patch.stayDuration !== undefined) values.stay_duration = patch.stayDuration;
    if (Object.keys(values).length > 0) {
      unwrap<PostRow>(
        await client.from(POSTS).update(values).eq("id", id).select("*").single(),
        "posts.update",
      );
    }
    if (patch.images) {
      // 画像一式を置き換える
      unwrapNullable(
        await client.from("post_images").delete().eq("post_id", id),
        "posts.update.deleteImages",
      );
      await this.insertImages(client, id, patch.images);
    }
    const view = await this.getByIdWith(client, id);
    if (!view) throw new Error("posts.update: 投稿が見つかりません");
    return view;
  }

  async delete(id: string): Promise<{ deletedImagePaths: string[] }> {
    const { client } = await this.clients.user();
    const images = unwrapNullable<Pick<PostImageRow, "full_path" | "thumb_path">[]>(
      await client.from("post_images").select("full_path, thumb_path").eq("post_id", id),
      "posts.delete.images",
    );
    unwrapNullable(await client.from(POSTS).delete().eq("id", id), "posts.delete");
    return { deletedImagePaths: (images ?? []).flatMap((img) => [img.full_path, img.thumb_path]) };
  }

  async setStatus(id: string, status: "public" | "hidden"): Promise<void> {
    unwrapNullable(await this.clients.admin().from(POSTS).update({ status }).eq("id", id), "posts.setStatus");
  }

  async countRecentByUser(userId: string, windowMs: number): Promise<number> {
    const since = new Date(Date.now() - windowMs).toISOString();
    const count = unwrapNullable<number>(
      await this.clients.admin().rpc("count_recent_posts", { p_user_id: userId, p_since: since }),
      "posts.countRecentByUser",
    );
    return toNumber(count);
  }
}

// ---------- likes ----------
class SupabaseLikesRepo implements LikesRepo {
  constructor(private readonly clients: Clients) {}

  private async likeCount(client: Client, postId: string): Promise<number> {
    const row = unwrapNullable<{ like_count: number }>(
      await client.from(POSTS).select("like_count").eq("id", postId).maybeSingle(),
      "likes.count",
    );
    return toNumber(row?.like_count);
  }

  async add(userId: string, postId: string): Promise<{ likeCount: number }> {
    const { client } = await this.clients.user();
    const { error } = await client.from("likes").insert({ user_id: userId, post_id: postId });
    // 既にいいね済み（主キー重複）なら何もしない
    if (error && !isUniqueViolation(error)) throw new Error(`likes.add: ${error.message}`);
    return { likeCount: await this.likeCount(client, postId) };
  }

  async remove(userId: string, postId: string): Promise<{ likeCount: number }> {
    const { client } = await this.clients.user();
    unwrapNullable(
      await client.from("likes").delete().eq("user_id", userId).eq("post_id", postId),
      "likes.remove",
    );
    return { likeCount: await this.likeCount(client, postId) };
  }
}

// ---------- wishlists ----------
interface WishlistWithCountRow extends WishlistRow {
  wishlist_items: { count: number }[] | null;
}

interface WishlistDetailRow extends WishlistRow {
  wishlist_items: WishlistItemRow[] | null;
  plans: PlanRow[] | null;
}

class SupabaseWishlistsRepo implements WishlistsRepo {
  constructor(
    private readonly clients: Clients,
    private readonly spots: SupabaseSpotsRepo,
  ) {}

  async listByUser(userId: string): Promise<Wishlist[]> {
    const { client } = await this.clients.user();
    const rows = unwrapNullable<WishlistWithCountRow[]>(
      await client
        .from("wishlists")
        .select("*, wishlist_items(count)")
        .eq("user_id", userId)
        .order("created_at", { ascending: true }),
      "wishlists.listByUser",
    );
    return (rows ?? []).map((r) => mapWishlist(r, toNumber(r.wishlist_items?.[0]?.count)));
  }

  async countByUser(userId: string): Promise<number> {
    const { client } = await this.clients.user();
    const { count, error } = await client
      .from("wishlists")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if (error) throw new Error(`wishlists.countByUser: ${error.message}`);
    return count ?? 0;
  }

  async create(input: { userId: string; name: string }): Promise<Wishlist> {
    const { client } = await this.clients.user();
    const row = unwrap<WishlistRow>(
      await client.from("wishlists").insert({ user_id: input.userId, name: input.name }).select("*").single(),
      "wishlists.create",
    );
    return mapWishlist(row, 0);
  }

  /** 項目行をスポット要約つきの WishlistItem にする */
  private async buildItems(rows: WishlistItemRow[]): Promise<WishlistItem[]> {
    const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const summaries = await this.spots.getManyByIds(sorted.map((r) => r.spot_id));
    const byId = new Map(summaries.map((s) => [s.id, s]));
    return sorted.map((r) => ({
      spotId: r.spot_id,
      mustVisit: Boolean(r.must_visit),
      createdAt: mapWishlist({ ...r, id: "", user_id: "", name: "", share_token: null }, 0).createdAt,
      // 削除されたスポットは null（F-4 例外）
      spot: byId.get(r.spot_id) ?? null,
    }));
  }

  async getById(id: string): Promise<WishlistDetail | null> {
    const { client } = await this.clients.user();
    const row = unwrapNullable<WishlistDetailRow>(
      await client.from("wishlists").select("*, wishlist_items(*), plans(*)").eq("id", id).maybeSingle(),
      "wishlists.getById",
    );
    if (!row) return null;
    const items = await this.buildItems(row.wishlist_items ?? []);
    const plans: PlanSummary[] = [...(row.plans ?? [])]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(mapPlanSummary);
    return { ...mapWishlist(row, items.length), items, plans };
  }

  async rename(id: string, name: string): Promise<Wishlist> {
    const { client } = await this.clients.user();
    const row = unwrap<WishlistWithCountRow>(
      await client
        .from("wishlists")
        .update({ name })
        .eq("id", id)
        .select("*, wishlist_items(count)")
        .single(),
      "wishlists.rename",
    );
    return mapWishlist(row, toNumber(row.wishlist_items?.[0]?.count));
  }

  async delete(id: string): Promise<void> {
    const { client } = await this.clients.user();
    unwrapNullable(await client.from("wishlists").delete().eq("id", id), "wishlists.delete");
  }

  private async itemCount(client: Client, listId: string): Promise<number> {
    const { count, error } = await client
      .from("wishlist_items")
      .select("spot_id", { count: "exact", head: true })
      .eq("wishlist_id", listId);
    if (error) throw new Error(`wishlists.itemCount: ${error.message}`);
    return count ?? 0;
  }

  async addItem(listId: string, spotId: string): Promise<{ added: boolean; itemCount: number }> {
    const { client } = await this.clients.user();
    const { error } = await client.from("wishlist_items").insert({ wishlist_id: listId, spot_id: spotId });
    if (error && !isUniqueViolation(error)) throw new Error(`wishlists.addItem: ${error.message}`);
    return { added: !error, itemCount: await this.itemCount(client, listId) };
  }

  async setMustVisit(listId: string, spotId: string, mustVisit: boolean): Promise<boolean> {
    const { client } = await this.clients.user();
    const rows = unwrapNullable<{ spot_id: string }[]>(
      await client
        .from("wishlist_items")
        .update({ must_visit: mustVisit })
        .eq("wishlist_id", listId)
        .eq("spot_id", spotId)
        .select("spot_id"),
      "wishlists.setMustVisit",
    );
    return (rows ?? []).length > 0;
  }

  async removeItem(listId: string, spotId: string): Promise<boolean> {
    const { client } = await this.clients.user();
    const rows = unwrapNullable<{ spot_id: string }[]>(
      await client
        .from("wishlist_items")
        .delete()
        .eq("wishlist_id", listId)
        .eq("spot_id", spotId)
        .select("spot_id"),
      "wishlists.removeItem",
    );
    return (rows ?? []).length > 0;
  }

  async setShareToken(listId: string, token: string | null): Promise<void> {
    const { client } = await this.clients.user();
    unwrapNullable(
      await client.from("wishlists").update({ share_token: token }).eq("id", listId),
      "wishlists.setShareToken",
    );
  }

  async getByShareToken(token: string): Promise<SharedWishlist | null> {
    // 共有リストはログインなしで閲覧できるため service role で読む（RLS の対象外）
    const admin = this.clients.admin();
    const row = unwrapNullable<
      WishlistRow & { wishlist_items: WishlistItemRow[] | null; profiles: { display_name: string } | null }
    >(
      await admin
        .from("wishlists")
        .select("*, wishlist_items(*), profiles(display_name)")
        .eq("share_token", token)
        .maybeSingle(),
      "wishlists.getByShareToken",
    );
    if (!row) return null;
    const items = await this.buildItems(row.wishlist_items ?? []);
    return { name: row.name, ownerDisplayName: row.profiles?.display_name ?? "", items };
  }
}

// ---------- plans ----------
class SupabasePlansRepo implements PlansRepo {
  constructor(private readonly clients: Clients) {}

  async create(input: {
    userId: string;
    wishlistId: string;
    params: PlanParams;
    result: PlanResult;
  }): Promise<Plan> {
    const { client } = await this.clients.user();
    const row = unwrap<PlanRow>(
      await client
        .from("plans")
        .insert({
          user_id: input.userId,
          wishlist_id: input.wishlistId,
          params: input.params,
          result: input.result,
          total_travel_min: Math.round(input.result.totalTravelMin ?? 0),
        })
        .select("*")
        .single(),
      "plans.create",
    );
    return mapPlan(row);
  }

  async getById(id: string): Promise<Plan | null> {
    const { client } = await this.clients.user();
    const row = unwrapNullable<PlanRow>(
      await client.from("plans").select("*").eq("id", id).maybeSingle(),
      "plans.getById",
    );
    return row ? mapPlan(row) : null;
  }

  async listByWishlist(wishlistId: string): Promise<PlanSummary[]> {
    const { client } = await this.clients.user();
    const rows = unwrapNullable<PlanRow[]>(
      await client
        .from("plans")
        .select("*")
        .eq("wishlist_id", wishlistId)
        .order("created_at", { ascending: false }),
      "plans.listByWishlist",
    );
    return (rows ?? []).map(mapPlanSummary);
  }

  async delete(id: string): Promise<void> {
    const { client } = await this.clients.user();
    unwrapNullable(await client.from("plans").delete().eq("id", id), "plans.delete");
  }
}

// ---------- travel_time_cache（service role） ----------
class SupabaseTravelCacheRepo implements TravelCacheRepo {
  constructor(private readonly clients: Clients) {}

  async getMany(
    pairs: { fromKey: string; toKey: string }[],
    mode: TravelMode,
  ): Promise<Map<string, TravelTimeEntry>> {
    const result = new Map<string, TravelTimeEntry>();
    if (pairs.length === 0) return result;
    const wanted = new Set(pairs.map((p) => `${p.fromKey}|${p.toKey}`));
    const cutoff = new Date(Date.now() - LIMITS.travelCacheDays * 24 * 60 * 60 * 1000).toISOString();
    const rows = unwrapNullable<TravelTimeCacheRow[]>(
      await this.clients
        .admin()
        .from("travel_time_cache")
        .select("*")
        .eq("mode", mode)
        .in("from_key", Array.from(new Set(pairs.map((p) => p.fromKey))))
        .in("to_key", Array.from(new Set(pairs.map((p) => p.toKey))))
        .gte("fetched_at", cutoff),
      "travelCache.getMany",
    );
    for (const r of rows ?? []) {
      const key = `${r.from_key}|${r.to_key}`;
      if (wanted.has(key)) result.set(key, mapTravelTime(r));
    }
    return result;
  }

  async putMany(entries: Omit<TravelTimeEntry, "fetchedAt">[]): Promise<void> {
    if (entries.length === 0) return;
    const now = new Date().toISOString();
    const values = entries.map((e) => ({
      from_key: e.fromKey,
      to_key: e.toKey,
      mode: e.mode,
      duration_sec: Math.round(e.durationSec),
      distance_m: Math.round(e.distanceM),
      fetched_at: now,
    }));
    unwrapNullable(
      await this.clients
        .admin()
        .from("travel_time_cache")
        .upsert(values, { onConflict: "from_key,to_key,mode" }),
      "travelCache.putMany",
    );
  }

  async purgeExpired(olderThanDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
    const { count, error } = await this.clients
      .admin()
      .from("travel_time_cache")
      .delete({ count: "exact" })
      .lt("fetched_at", cutoff);
    if (error) throw new Error(`travelCache.purgeExpired: ${error.message}`);
    return count ?? 0;
  }
}

// ---------- api_usage（service role） ----------
class SupabaseApiUsageRepo implements ApiUsageRepo {
  constructor(private readonly clients: Clients) {}

  async get(provider: string, feature: Feature, period: string): Promise<ApiUsage | null> {
    const row = unwrapNullable<ApiUsageRow>(
      await this.clients
        .admin()
        .from("api_usage")
        .select("*")
        .eq("provider", provider)
        .eq("feature", feature)
        .eq("period", period)
        .maybeSingle(),
      "apiUsage.get",
    );
    return row ? mapApiUsage(row) : null;
  }

  async increment(
    provider: string,
    feature: Feature,
    period: string,
    limit: number,
    by = 1,
  ): Promise<ApiUsage> {
    const row = unwrap<ApiUsageRow>(
      await this.clients.admin().rpc("increment_api_usage", {
        p_provider: provider,
        p_feature: feature,
        p_period: period,
        p_limit: limit,
        p_by: by,
      }),
      "apiUsage.increment",
    );
    return mapApiUsage(row);
  }

  async set(
    provider: string,
    feature: Feature,
    period: string,
    count: number,
    limit: number,
  ): Promise<ApiUsage> {
    const row = unwrap<ApiUsageRow>(
      await this.clients
        .admin()
        .from("api_usage")
        .upsert({ provider, feature, period, count, limit }, { onConflict: "provider,feature,period" })
        .select("*")
        .single(),
      "apiUsage.set",
    );
    return mapApiUsage(row);
  }

  async setSuspended(
    provider: string,
    feature: Feature,
    period: string,
    suspendedAt: string | null,
  ): Promise<void> {
    unwrapNullable(
      await this.clients
        .admin()
        .from("api_usage")
        .update({ suspended_at: suspendedAt })
        .eq("provider", provider)
        .eq("feature", feature)
        .eq("period", period),
      "apiUsage.setSuspended",
    );
  }

  async listSuspended(periods: string[]): Promise<SuspendedFeature[]> {
    if (periods.length === 0) return [];
    const rows = unwrapNullable<ApiUsageRow[]>(
      await this.clients
        .admin()
        .from("api_usage")
        .select("*")
        .in("period", periods)
        .not("suspended_at", "is", null),
      "apiUsage.listSuspended",
    );
    return (rows ?? []).flatMap((r) => {
      const s = mapSuspended(r);
      return s ? [s] : [];
    });
  }
}

// ---------- reports（service role） ----------
class SupabaseReportsRepo implements ReportsRepo {
  constructor(
    private readonly clients: Clients,
    private readonly posts: SupabasePostsRepo,
  ) {}

  private async countByPost(postId: string): Promise<number> {
    const { count, error } = await this.clients
      .admin()
      .from("reports")
      .select("id", { count: "exact", head: true })
      .eq("post_id", postId);
    if (error) throw new Error(`reports.count: ${error.message}`);
    return count ?? 0;
  }

  async create(input: {
    postId: string;
    reporterId: string;
    reason: Report["reason"];
    note: string | null;
  }): Promise<{ created: boolean; count: number }> {
    const { error } = await this.clients.admin().from("reports").insert({
      post_id: input.postId,
      reporter_id: input.reporterId,
      reason: input.reason,
      note: input.note,
    });
    // 同じ投稿への二重通報は無視する
    if (error && !isUniqueViolation(error)) throw new Error(`reports.create: ${error.message}`);
    return { created: !error, count: await this.countByPost(input.postId) };
  }

  async listOpen(paging: Paging): Promise<Page<Report & { post: PostView | null }>> {
    const admin = this.clients.admin();
    const limit = Math.max(1, paging.limit);
    let query = admin.from("reports").select("*").eq("status", "open");
    const cursor = decodeCursor(paging.cursor);
    if (cursor) query = query.or(keysetOlderThan(cursor.createdAt, cursor.id));
    const rows = unwrapNullable<ReportRow[]>(
      await query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit + 1),
      "reports.listOpen",
    );
    const all = rows ?? [];
    const pageRows = all.slice(0, limit);
    const last = pageRows[pageRows.length - 1];
    const nextCursor =
      all.length > limit && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null;
    // 通報対象の投稿は非表示でも管理者に見せるため service role で読む
    const items = await Promise.all(
      pageRows.map(async (r) => ({
        ...mapReport(r),
        post: await this.posts.getByIdWith(admin, r.post_id, null),
      })),
    );
    return { items, nextCursor };
  }

  async resolveByPost(postId: string): Promise<void> {
    unwrapNullable(
      await this.clients
        .admin()
        .from("reports")
        .update({ status: "resolved" })
        .eq("post_id", postId)
        .eq("status", "open"),
      "reports.resolveByPost",
    );
  }
}

// ---------- storage（service role） ----------
class SupabaseStorageRepo implements StorageRepo {
  constructor(
    private readonly clients: Clients,
    private readonly url: PublicUrlFn,
  ) {}

  private bucket() {
    return this.clients.admin().storage.from(STORAGE_BUCKET);
  }

  async createSignedUploads(userId: string, files: UploadRequestFile[]): Promise<UploadTarget[]> {
    const targets: UploadTarget[] = [];
    for (const file of files) {
      const ext = file.contentType === "image/jpeg" ? "jpg" : "webp";
      const path = `posts/tmp/${userId}/${newId()}${file.kind === "thumb" ? "_t" : ""}.${ext}`;
      const { data, error } = await this.bucket().createSignedUploadUrl(path);
      if (error || !data)
        throw new Error(`storage.createSignedUploads: ${error?.message ?? "署名付き URL を発行できません"}`);
      // ブラウザはこの URL へ PUT する
      targets.push({ kind: file.kind, path, signedUrl: data.signedUrl });
    }
    return targets;
  }

  async finalizePostImages(
    postId: string,
    images: { fullPath: string; thumbPath: string }[],
  ): Promise<{ fullPath: string; thumbPath: string }[]> {
    const out: { fullPath: string; thumbPath: string }[] = [];
    for (const img of images) {
      const imageId = newId();
      const fullPath = `posts/${postId}/${imageId}${extOf(img.fullPath)}`;
      const thumbPath = `posts/${postId}/${imageId}_t${extOf(img.thumbPath)}`;
      const full = await this.bucket().move(img.fullPath, fullPath);
      if (full.error)
        throw new Error(
          `storage.finalizePostImages: ${img.fullPath} を移動できません（${full.error.message}）`,
        );
      const thumb = await this.bucket().move(img.thumbPath, thumbPath);
      if (thumb.error)
        throw new Error(
          `storage.finalizePostImages: ${img.thumbPath} を移動できません（${thumb.error.message}）`,
        );
      out.push({ fullPath, thumbPath });
    }
    return out;
  }

  async deleteObjects(paths: string[]): Promise<void> {
    const unique = Array.from(new Set(paths.filter(Boolean)));
    if (unique.length === 0) return;
    const { error } = await this.bucket().remove(unique);
    if (error) throw new Error(`storage.deleteObjects: ${error.message}`);
  }

  publicUrl(path: string): string {
    return this.url(path);
  }

  async deleteStaleTmp(olderThanHours: number): Promise<number> {
    const cutoff = Date.now() - olderThanHours * 60 * 60 * 1000;
    const stale: string[] = [];
    // posts/tmp/{userId}/ を再帰的にたどり、古いファイルを集める
    const walk = async (prefix: string): Promise<void> => {
      const pageSize = 1000;
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await this.bucket().list(prefix, { limit: pageSize, offset });
        if (error) throw new Error(`storage.deleteStaleTmp: ${error.message}`);
        const entries = data ?? [];
        for (const entry of entries) {
          const path = `${prefix}/${entry.name}`;
          if (entry.id == null) {
            await walk(path);
          } else if (entry.created_at && new Date(entry.created_at).getTime() < cutoff) {
            stale.push(path);
          }
        }
        if (entries.length < pageSize) break;
      }
    };
    await walk("posts/tmp");
    for (let i = 0; i < stale.length; i += 100) {
      await this.deleteObjects(stale.slice(i, i + 100));
    }
    return stale.length;
  }
}

/** パスの拡張子（.webp など）。なければ .webp */
function extOf(path: string): string {
  const m = /(\.[a-zA-Z0-9]+)$/.exec(path);
  return m ? m[1] : ".webp";
}

// ---------- 組み立て ----------
export function createSupabaseRepository(): Repository {
  const clients = new Clients();
  const publicUrl: PublicUrlFn = (path) => clients.publicUrl(path);
  const spots = new SupabaseSpotsRepo(clients, publicUrl);
  const posts = new SupabasePostsRepo(clients, publicUrl);
  return {
    backend: "supabase",
    profiles: new SupabaseProfilesRepo(clients),
    spots,
    posts,
    likes: new SupabaseLikesRepo(clients),
    wishlists: new SupabaseWishlistsRepo(clients, spots),
    plans: new SupabasePlansRepo(clients),
    travelCache: new SupabaseTravelCacheRepo(clients),
    apiUsage: new SupabaseApiUsageRepo(clients),
    reports: new SupabaseReportsRepo(clients, posts),
    storage: new SupabaseStorageRepo(clients, publicUrl),
  };
}
