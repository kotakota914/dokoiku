/**
 * Repository の共通インターフェース。
 * - memory 実装（src/lib/repo/memory）と supabase 実装（src/lib/repo/supabase）が同じ契約を満たす。
 * - API（Route Handler）はこの契約だけに依存し、実装の違いを知らない。
 * - 権限チェック（本人かどうか等）は Service/API 側で行い、Repository は「誰が」を引数で受け取るだけ。
 *   ただし supabase 実装は RLS でも二重に守る。
 * - 見つからないときは null を返す（throw しない）。重複などの業務エラーは API 側で ApiError にする。
 */
import type { Category, Feature, StayDuration, TravelMode } from "@/lib/domain/types-reexport";
import type {
  ApiUsage,
  HeatPoint,
  LatLng,
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
} from "@/lib/domain/types";

export interface Bbox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export interface Paging {
  cursor?: string;
  limit: number;
}

export interface ProfilesRepo {
  getById(id: string): Promise<Profile | null>;
  /** 初回ログイン時に作成。既にあればそのまま返す */
  create(input: { id: string; displayName: string; avatarUrl?: string | null }): Promise<Profile>;
  update(id: string, patch: { displayName?: string; avatarUrl?: string | null }): Promise<Profile>;
  /** 退会：投稿・画像・いいね・リスト・プラン・通報をすべて削除してからプロフィールを消す（F-6-4） */
  deleteAccount(id: string): Promise<{ deletedImagePaths: string[] }>;
}

export interface SpotsRepo {
  /** 表示範囲内のスポット。投稿数の多い順、公開投稿が1件以上あるもののみ（F-2-14） */
  inBbox(q: { bbox: Bbox; categories?: Category[]; limit: number }): Promise<SpotSummary[]>;
  /** ヒートマップ用の点（weight = 投稿数） */
  heatmap(q: { bbox: Bbox; categories?: Category[]; limit: number }): Promise<HeatPoint[]>;
  /** 現在地から radiusM 以内を近い順に */
  nearby(q: { lat: number; lng: number; radiusM: number; limit: number }): Promise<NearbySpot[]>;
  search(q: {
    keyword?: string;
    prefecture?: string;
    city?: string;
    category?: Category;
    sort: "popular" | "newest";
    paging: Paging;
  }): Promise<Page<SpotSummary>>;
  getById(id: string): Promise<SpotDetail | null>;
  getManyByIds(ids: string[]): Promise<SpotSummary[]>;
  /** POST /posts の重複判定：半径 radiusM 以内で名前が似ているスポット（表記ゆれは正規化して比較） */
  findSimilarName(q: { name: string; lat: number; lng: number; radiusM: number }): Promise<SpotSummary[]>;
  create(input: {
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
  }): Promise<Spot>;
  /** 投稿の作成・編集・削除のあとに呼ぶ（F-2-13）：post_count、like_count、代表写真、滞在時間中央値、時間帯分布、カテゴリ */
  recomputeStats(spotId: string): Promise<void>;
  /**
   * v0.3 F-1-5：人気度を市区町村内の相対順位で再計算する（POPULARITY_RANKING）。
   * 投稿の作成・削除のあとと、1日1回の定期処理から呼ぶ。戻り値は更新したスポット数。
   */
  recomputePopularity(scope?: { prefecture?: string | null; city?: string | null }): Promise<number>;
}

export interface PostsRepo {
  /** 新着順。status=public のみ（viewerId が本人・管理者なら hidden も含めてよい） */
  listBySpot(spotId: string, paging: Paging, viewerId?: string | null): Promise<Page<PostView>>;
  listByUser(userId: string, paging: Paging, viewerId?: string | null): Promise<Page<PostView>>;
  getById(id: string, viewerId?: string | null): Promise<PostView | null>;
  create(input: {
    userId: string;
    spotId: string;
    comment: string;
    category: Category;
    stayDuration: StayDuration | null;
    images: Omit<PostImage, "id">[];
  }): Promise<PostView>;
  update(
    id: string,
    patch: {
      comment?: string;
      category?: Category;
      stayDuration?: StayDuration | null;
      /** 指定したら画像一式を置き換える */
      images?: Omit<PostImage, "id">[];
    },
  ): Promise<PostView>;
  /** 削除した投稿が持っていた画像パスを返す（Storage から消すため） */
  delete(id: string): Promise<{ deletedImagePaths: string[] }>;
  setStatus(id: string, status: "public" | "hidden"): Promise<void>;
  /** 直近 windowMs 以内にこのユーザーが作成した投稿数（レート制限用） */
  countRecentByUser(userId: string, windowMs: number): Promise<number>;
}

export interface LikesRepo {
  /** 既にいいね済みなら何もしない。戻り値は最新のいいね数 */
  add(userId: string, postId: string): Promise<{ likeCount: number }>;
  remove(userId: string, postId: string): Promise<{ likeCount: number }>;
}

export interface WishlistsRepo {
  listByUser(userId: string): Promise<Wishlist[]>;
  countByUser(userId: string): Promise<number>;
  create(input: { userId: string; name: string }): Promise<Wishlist>;
  getById(id: string): Promise<WishlistDetail | null>;
  rename(id: string, name: string): Promise<Wishlist>;
  /** v0.3 F-4-8：拠点を設定（null で解除） */
  setBase(id: string, base: { label: string; location: LatLng } | null): Promise<Wishlist>;
  delete(id: string): Promise<void>;
  /** 既にあれば false を返す（API は 409） */
  addItem(listId: string, spotId: string): Promise<{ added: boolean; itemCount: number }>;
  setMustVisit(listId: string, spotId: string, mustVisit: boolean): Promise<boolean>;
  removeItem(listId: string, spotId: string): Promise<boolean>;
  setShareToken(listId: string, token: string | null): Promise<void>;
  getByShareToken(token: string): Promise<SharedWishlist | null>;
}

export interface PlansRepo {
  create(input: {
    userId: string;
    wishlistId: string;
    params: PlanParams;
    result: PlanResult;
  }): Promise<Plan>;
  getById(id: string): Promise<Plan | null>;
  listByWishlist(wishlistId: string): Promise<PlanSummary[]>;
  delete(id: string): Promise<void>;
}

export interface TravelCacheRepo {
  /**
   * 見つかったものだけ返す（期限切れは除く。期限は TRAVEL_CACHE_DAYS[mode]）。キーは `${fromKey}|${toKey}`。
   * timeBucket は公共交通のみ意味を持つ（徒歩・車は "any"）
   */
  getMany(
    pairs: { fromKey: string; toKey: string }[],
    mode: TravelMode,
    timeBucket?: string,
  ): Promise<Map<string, TravelTimeEntry>>;
  putMany(entries: Omit<TravelTimeEntry, "fetchedAt">[]): Promise<void>;
  /** mode ごとの期限（TRAVEL_CACHE_DAYS）を超えたものを削除する。olderThanDays を渡した場合はそれを優先 */
  purgeExpired(olderThanDays?: number): Promise<number>;
}

export interface ApiUsageRepo {
  get(provider: string, feature: Feature, period: string): Promise<ApiUsage | null>;
  /** 回数を加算して最新値を返す。limit は初回作成時に保存する */
  increment(
    provider: string,
    feature: Feature,
    period: string,
    limit: number,
    by?: number,
  ): Promise<ApiUsage>;
  /** 使用量を絶対値で記録する（Supabase の容量など、外部から測って書き込む用） */
  set(provider: string, feature: Feature, period: string, count: number, limit: number): Promise<ApiUsage>;
  setSuspended(provider: string, feature: Feature, period: string, suspendedAt: string | null): Promise<void>;
  /** 現在の期間で停止中のもの */
  listSuspended(periods: string[]): Promise<SuspendedFeature[]>;
}

export interface ReportsRepo {
  /** 同じ投稿への二重通報は false。戻り値 count はその投稿の未処理（open）の通報数（resolveByPost 後は数え直す） */
  create(input: {
    postId: string;
    reporterId: string;
    reason: Report["reason"];
    note: string | null;
  }): Promise<{ created: boolean; count: number }>;
  listOpen(paging: Paging): Promise<Page<Report & { post: PostView | null }>>;
  resolveByPost(postId: string): Promise<void>;
}

export interface StorageRepo {
  /** 一時パスへの署名付きアップロード先を発行する */
  createSignedUploads(userId: string, files: UploadRequestFile[]): Promise<UploadTarget[]>;
  /** 一時パスを posts/{postId}/ へ移動し、確定パスを返す（存在しないパスは例外） */
  finalizePostImages(
    postId: string,
    images: { fullPath: string; thumbPath: string }[],
  ): Promise<{ fullPath: string; thumbPath: string }[]>;
  deleteObjects(paths: string[]): Promise<void>;
  publicUrl(path: string): string;
  /** 24時間以上前の一時ファイルを削除し、件数を返す */
  deleteStaleTmp(olderThanHours: number): Promise<number>;
}

export interface Repository {
  readonly backend: "memory" | "supabase";
  profiles: ProfilesRepo;
  spots: SpotsRepo;
  posts: PostsRepo;
  likes: LikesRepo;
  wishlists: WishlistsRepo;
  plans: PlansRepo;
  travelCache: TravelCacheRepo;
  apiUsage: ApiUsageRepo;
  reports: ReportsRepo;
  storage: StorageRepo;
}
