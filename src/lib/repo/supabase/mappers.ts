/**
 * Supabase の行（snake_case）をドメイン型（camelCase）へ変換する純粋関数。
 * supabase-js の型生成は使わず、必要最小限の Row 型をここに手書きする。
 * server-only を import しないので vitest から直接テストできる。
 */
import type {
  Category,
  Popularity,
  ReportReason,
  StayDuration,
  TravelMode,
} from "@/lib/domain/types-reexport";
import { popularityOf, TRAVEL_CACHE_DAYS, type PlanMethod } from "@/lib/domain/constants";
import { normalizePlanParams, normalizePlanResult } from "../normalize";
import type {
  ApiUsage,
  HeatPoint,
  LatLng,
  NearbySpot,
  OpeningHours,
  Plan,
  PlanParams,
  PlanResult,
  PlanSummary,
  PostImageView,
  PostView,
  Profile,
  Report,
  Spot,
  SpotDetail,
  SpotSummary,
  SuspendedFeature,
  TravelTimeEntry,
  Wishlist,
} from "@/lib/domain/types";
import type { Feature } from "@/lib/domain/constants";
import { toJstIso } from "@/lib/utils/time";

// ---------- Row 型（テーブル・RPC の列） ----------
export interface ProfileRow {
  id: string;
  display_name: string;
  avatar_url: string | null;
  is_admin: boolean;
  created_at: string;
}

export interface SpotRow {
  id: string;
  name: string;
  /** PostgREST は geography を hex EWKB の文字列で返す */
  location: string;
  address: string | null;
  prefecture: string | null;
  city: string | null;
  category: Category;
  source: Spot["source"];
  external_ref: string | null;
  post_count: number;
  like_count: number;
  cover_image_id: string | null;
  stay_minutes_median: number | null;
  hour_histogram: number[] | null;
  opening_hours: OpeningHours | null;
  /** v0.3 F-1-5：recompute_popularity() が更新する。古い行は null のことがある */
  popularity?: Popularity | null;
  created_by: string | null;
  created_at: string;
}

/** spots_in_bbox / spots_search / spots_nearby が返す要約行 */
export interface SpotSummaryRow {
  id: string;
  name: string;
  lat: number;
  lng: number;
  category: Category;
  post_count: number;
  like_count: number;
  prefecture: string | null;
  city: string | null;
  cover_thumb_path: string | null;
  popularity?: Popularity | null;
}

export interface SpotSearchRow extends SpotSummaryRow {
  score: number;
  created_at: string;
}

export interface NearbyRow extends SpotSummaryRow {
  distance_m: number;
}

export interface HeatRow {
  lat: number;
  lng: number;
  weight: number;
}

export interface PostRow {
  id: string;
  user_id: string;
  spot_id: string;
  comment: string;
  category: Category;
  stay_duration: StayDuration | null;
  like_count: number;
  status: "public" | "hidden";
  created_at: string;
  updated_at: string;
}

export interface PostImageRow {
  id: string;
  post_id: string;
  full_path: string;
  thumb_path: string;
  width: number;
  height: number;
  sort_order: number;
}

/** posts に post_images・profiles・spots を埋め込んだ行（embedded select） */
export interface PostJoinedRow extends PostRow {
  post_images: PostImageRow[] | null;
  profiles: Pick<ProfileRow, "id" | "display_name" | "avatar_url"> | null;
  spots: { name: string } | null;
}

export interface WishlistRow {
  id: string;
  user_id: string;
  name: string;
  /** v0.3 F-4-8：拠点。base_location は PostGIS の hex EWKB（location と同じ読み方） */
  base_label?: string | null;
  base_location?: string | null;
  share_token: string | null;
  created_at: string;
}

export interface WishlistItemRow {
  wishlist_id?: string;
  spot_id: string;
  must_visit: boolean;
  created_at: string;
}

export interface PlanRow {
  id: string;
  wishlist_id: string;
  user_id: string;
  params: PlanParams;
  result: PlanResult;
  total_travel_min: number;
  /** v0.3：作り方。古い行は null → auto */
  method?: PlanMethod | null;
  created_at: string;
}

export interface TravelTimeCacheRow {
  from_key: string;
  to_key: string;
  mode: TravelMode;
  /** 公共交通のみ使う出発時刻の区分。徒歩・車は "any" */
  time_bucket?: string | null;
  duration_sec: number;
  distance_m: number;
  fetched_at: string;
}

export interface ApiUsageRow {
  provider: string;
  feature: Feature;
  period: string;
  count: number | string;
  limit: number | string;
  suspended_at: string | null;
}

export interface ReportRow {
  id: string;
  post_id: string;
  reporter_id: string;
  reason: ReportReason;
  note: string | null;
  status: "open" | "resolved";
  created_at: string;
}

/** Storage のパスから公開 URL を作る関数（Repository が渡す） */
export type PublicUrlFn = (path: string) => string;

// ---------- 共通 ----------

/** DB の timestamptz 文字列を +09:00 付きの ISO 8601 にそろえる */
export function toIso(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return toJstIso(d);
}

/** bigint 列（文字列で返ることがある）を number にする */
export function toNumber(value: number | string | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** 24 要素の int[] に整える（欠けていれば 0 で埋める） */
export function normalizeHistogram(value: number[] | null | undefined): number[] {
  const out = new Array<number>(24).fill(0);
  if (!value) return out;
  for (let i = 0; i < 24 && i < value.length; i += 1) out[i] = toNumber(value[i]);
  return out;
}

/**
 * PostGIS の hex EWKB（Point）から lat / lng を取り出す。
 * 例: 0101000020E6100000 + X(8 byte) + Y(8 byte)。SRID フラグ（0x20000000）があれば SRID 4 byte を読み飛ばす。
 */
export function parseEwkbPoint(hex: string): { lat: number; lng: number } {
  const clean = hex.trim();
  if (!/^[0-9a-fA-F]+$/.test(clean) || clean.length < 42) {
    throw new Error(`位置情報の形式が不正です: ${clean.slice(0, 20)}`);
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  const view = new DataView(bytes.buffer);
  const littleEndian = bytes[0] === 1;
  const type = view.getUint32(1, littleEndian);
  const hasSrid = (type & 0x20000000) !== 0;
  const geomType = type & 0x0fffffff;
  if (geomType !== 1) throw new Error(`Point 以外の位置情報は扱えません（type=${geomType}）`);
  let offset = 5 + (hasSrid ? 4 : 0);
  const x = view.getFloat64(offset, littleEndian);
  offset += 8;
  const y = view.getFloat64(offset, littleEndian);
  return { lat: y, lng: x };
}

/** insert / update で geography 列に渡す EWKT 文字列 */
export function toEwkt(p: { lat: number; lng: number }): string {
  return `SRID=4326;POINT(${p.lng} ${p.lat})`;
}

// ---------- プロフィール ----------
export function mapProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url ?? null,
    isAdmin: Boolean(row.is_admin),
    createdAt: toIso(row.created_at),
  };
}

// ---------- スポット ----------
export function mapSpot(row: SpotRow): Spot {
  const { lat, lng } = parseEwkbPoint(row.location);
  return {
    id: row.id,
    name: row.name,
    lat,
    lng,
    address: row.address ?? null,
    prefecture: row.prefecture ?? null,
    city: row.city ?? null,
    category: row.category,
    source: row.source,
    externalRef: row.external_ref ?? null,
    postCount: toNumber(row.post_count),
    likeCount: toNumber(row.like_count),
    coverImageId: row.cover_image_id ?? null,
    stayMinutesMedian: row.stay_minutes_median ?? null,
    hourHistogram: normalizeHistogram(row.hour_histogram),
    openingHours: row.opening_hours ?? null,
    createdBy: row.created_by ?? null,
    createdAt: toIso(row.created_at),
  };
}

/** 順位で計算した人気度（spots.popularity）を優先し、未計算（null）のときだけ件数しきい値で代替する */
export function resolvePopularity(stored: Popularity | null | undefined, postCount: number): Popularity {
  return stored ?? popularityOf(postCount);
}

/** RPC の要約行 → SpotSummary */
export function mapSpotSummaryRow(row: SpotSummaryRow, publicUrl: PublicUrlFn): SpotSummary {
  const postCount = toNumber(row.post_count);
  return {
    id: row.id,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    category: row.category,
    postCount,
    likeCount: toNumber(row.like_count),
    popularity: resolvePopularity(row.popularity, postCount),
    coverThumbUrl: row.cover_thumb_path ? publicUrl(row.cover_thumb_path) : null,
    prefecture: row.prefecture ?? null,
    city: row.city ?? null,
  };
}

export function mapNearbyRow(row: NearbyRow, publicUrl: PublicUrlFn): NearbySpot {
  return { ...mapSpotSummaryRow(row, publicUrl), distanceM: Math.round(toNumber(row.distance_m)) };
}

export function mapHeatRow(row: HeatRow): HeatPoint {
  return { lat: row.lat, lng: row.lng, weight: toNumber(row.weight) };
}

/** spots テーブルの行 → SpotSummary（代表写真のサムネイルパスは別途渡す） */
export function spotToSummary(
  spot: Spot,
  coverThumbPath: string | null,
  publicUrl: PublicUrlFn,
  popularity: Popularity | null = null,
): SpotSummary {
  return {
    id: spot.id,
    name: spot.name,
    lat: spot.lat,
    lng: spot.lng,
    category: spot.category,
    postCount: spot.postCount,
    likeCount: spot.likeCount,
    popularity: resolvePopularity(popularity, spot.postCount),
    coverThumbUrl: coverThumbPath ? publicUrl(coverThumbPath) : null,
    prefecture: spot.prefecture,
    city: spot.city,
  };
}

export function spotToDetail(
  spot: Spot,
  cover: { full_path: string; thumb_path: string } | null,
  publicUrl: PublicUrlFn,
  popularity: Popularity | null = null,
): SpotDetail {
  return {
    ...spotToSummary(spot, cover?.thumb_path ?? null, publicUrl, popularity),
    address: spot.address,
    stayMinutesMedian: spot.stayMinutesMedian,
    hourHistogram: spot.hourHistogram,
    openingHours: spot.openingHours,
    coverFullUrl: cover ? publicUrl(cover.full_path) : null,
    createdAt: spot.createdAt,
  };
}

// ---------- 投稿 ----------
export function mapPostImage(row: PostImageRow, publicUrl: PublicUrlFn): PostImageView {
  return {
    id: row.id,
    fullUrl: publicUrl(row.full_path),
    thumbUrl: publicUrl(row.thumb_path),
    width: toNumber(row.width),
    height: toNumber(row.height),
    sortOrder: toNumber(row.sort_order),
    fullPath: row.full_path,
    thumbPath: row.thumb_path,
  };
}

export function mapPostView(row: PostJoinedRow, publicUrl: PublicUrlFn, likedByMe: boolean): PostView {
  const images = [...(row.post_images ?? [])]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((img) => mapPostImage(img, publicUrl));
  return {
    id: row.id,
    userId: row.user_id,
    spotId: row.spot_id,
    comment: row.comment ?? "",
    category: row.category,
    stayDuration: row.stay_duration ?? null,
    likeCount: toNumber(row.like_count),
    status: row.status,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    author: {
      id: row.profiles?.id ?? row.user_id,
      displayName: row.profiles?.display_name ?? "退会したユーザー",
      avatarUrl: row.profiles?.avatar_url ?? null,
    },
    spotName: row.spots?.name ?? "",
    images,
    likedByMe,
  };
}

// ---------- リスト・プラン ----------
/** base_location（hex EWKB）→ LatLng。無い・壊れているときは null（拠点なし扱い） */
export function parseBaseLocation(value: string | null | undefined): LatLng | null {
  if (!value) return null;
  try {
    return parseEwkbPoint(value);
  } catch {
    return null;
  }
}

export function mapWishlist(row: WishlistRow, itemCount: number): Wishlist {
  const baseLocation = parseBaseLocation(row.base_location);
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    baseLabel: baseLocation && row.base_label ? row.base_label : null,
    baseLocation,
    shareToken: row.share_token ?? null,
    createdAt: toIso(row.created_at),
    itemCount,
  };
}

/** プラン内の訪問スポット数（result.items の type=spot を数える） */
export function countPlanSpots(
  result: PlanResult | null | undefined,
  params: PlanParams | null | undefined,
): number {
  const items = result?.items;
  if (Array.isArray(items)) return items.filter((it) => it && it.type === "spot").length;
  return params?.spotIds?.length ?? 0;
}

export function mapPlanSummary(row: PlanRow): PlanSummary {
  return {
    id: row.id,
    wishlistId: row.wishlist_id,
    date: row.params?.date ?? "",
    spotCount: countPlanSpots(row.result, row.params),
    totalTravelMin: toNumber(row.total_travel_min),
    method: row.method ?? row.params?.method ?? "auto",
    createdAt: toIso(row.created_at),
  };
}

/** v0.1 で保存した行（method / preferences / next / stats が無い）も v0.3 の形にそろえる */
export function mapPlan(row: PlanRow): Plan {
  const params = normalizePlanParams(row.params);
  const result = normalizePlanResult(row.result, params);
  return { ...mapPlanSummary(row), userId: row.user_id, params, result };
}

// ---------- 無料枠・キャッシュ・通報 ----------
export function mapApiUsage(row: ApiUsageRow): ApiUsage {
  return {
    provider: row.provider,
    feature: row.feature,
    period: row.period,
    count: toNumber(row.count),
    limit: toNumber(row.limit),
    suspendedAt: row.suspended_at ? toIso(row.suspended_at) : null,
  };
}

export function mapSuspended(row: ApiUsageRow): SuspendedFeature | null {
  if (!row.suspended_at) return null;
  return {
    feature: row.feature,
    provider: row.provider,
    period: row.period,
    count: toNumber(row.count),
    limit: toNumber(row.limit),
    suspendedAt: toIso(row.suspended_at),
  };
}

export function mapTravelTime(row: TravelTimeCacheRow): TravelTimeEntry {
  return {
    fromKey: row.from_key,
    toKey: row.to_key,
    mode: row.mode,
    timeBucket: row.time_bucket || "any",
    durationSec: toNumber(row.duration_sec),
    distanceM: toNumber(row.distance_m),
    fetchedAt: toIso(row.fetched_at),
  };
}

export function mapReport(row: ReportRow): Report {
  return {
    id: row.id,
    postId: row.post_id,
    reporterId: row.reporter_id,
    reason: row.reason,
    note: row.note ?? null,
    status: row.status,
    createdAt: toIso(row.created_at),
  };
}

/** mode ごとの期限（10.2）より前の fetched_at を ISO 文字列で返す（getMany / purgeExpired の境界） */
export function travelCacheCutoff(mode: TravelMode, now: Date = new Date(), olderThanDays?: number): string {
  const days = olderThanDays ?? TRAVEL_CACHE_DAYS[mode];
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

// ---------- カーソル ----------

/** 検索（人気順）のカーソルに入れる値。`score~createdAt` の形で createdAt 欄に入れる */
export function encodeSearchCursorValue(score: number, createdAt: string): string {
  return `${score}~${createdAt}`;
}

export function decodeSearchCursorValue(value: string): { score: number | null; createdAt: string } {
  const idx = value.indexOf("~");
  if (idx < 0) return { score: null, createdAt: value };
  const score = Number(value.slice(0, idx));
  return { score: Number.isFinite(score) ? score : null, createdAt: value.slice(idx + 1) };
}

/** PostgREST の or() フィルタ内で使う値をダブルクォートで囲む（カンマ・コロン・括弧を含んでも安全） */
export function quoteFilterValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
