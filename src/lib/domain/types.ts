/**
 * ドメイン型と API のレスポンス型。
 * - 「〜Row」は保存形（Repository が扱う）、それ以外は API・画面で使う形。
 * - 日時は ISO 8601 文字列（+09:00 付き）、座標は lat / lng（WGS84）。
 */
import type {
  Category,
  Feature,
  Interest,
  Pace,
  Popularity,
  ReportReason,
  StayDuration,
  TravelMode,
} from "./constants";

export type ISODateTime = string;
export type UUID = string;

// ---------- プロフィール ----------
export interface Profile {
  id: UUID;
  displayName: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  createdAt: ISODateTime;
}

// ---------- スポット ----------
export type SpotSource = "gps" | "search_db" | "search_external";

export interface Spot {
  id: UUID;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  prefecture: string | null;
  city: string | null;
  category: Category;
  source: SpotSource;
  externalRef: string | null;
  postCount: number;
  likeCount: number;
  coverImageId: UUID | null;
  stayMinutesMedian: number | null;
  /** 24要素。投稿時刻（日本時間）の分布 */
  hourHistogram: number[];
  /** Q10：MVP では常に null。将来 OSM の opening_hours を入れる */
  openingHours: OpeningHours | null;
  createdBy: UUID | null;
  createdAt: ISODateTime;
}

/** 曜日ごとの営業時間（0=日〜6=土）。null の曜日は定休日。未設定なら判定しない */
export type OpeningHours = Partial<Record<"0" | "1" | "2" | "3" | "4" | "5" | "6", { open: string; close: string } | null>>;

/** GET /spots、検索結果、リスト内などで使う要約 */
export interface SpotSummary {
  id: UUID;
  name: string;
  lat: number;
  lng: number;
  category: Category;
  postCount: number;
  likeCount: number;
  popularity: Popularity;
  coverThumbUrl: string | null;
  prefecture: string | null;
  city: string | null;
}

/** GET /spots/{spotId} */
export interface SpotDetail extends SpotSummary {
  address: string | null;
  stayMinutesMedian: number | null;
  hourHistogram: number[];
  openingHours: OpeningHours | null;
  coverFullUrl: string | null;
  createdAt: ISODateTime;
}

export interface HeatPoint {
  lat: number;
  lng: number;
  weight: number;
}

export type SpotsInViewResponse =
  | { mode: "spots"; spots: SpotSummary[] }
  | { mode: "heatmap"; points: HeatPoint[] };

export interface NearbySpot extends SpotSummary {
  distanceM: number;
}

export interface NearbyResponse {
  canCreate: boolean;
  spots: NearbySpot[];
}

// ---------- 投稿 ----------
export type PostStatus = "public" | "hidden";

export interface PostImage {
  id: UUID;
  fullPath: string;
  thumbPath: string;
  width: number;
  height: number;
  sortOrder: number;
}

export interface PostImageView {
  id: UUID;
  fullUrl: string;
  thumbUrl: string;
  width: number;
  height: number;
  sortOrder: number;
  /** Storage 上のパス（投稿の編集・削除で古い画像を消すために API が使う）。公開バケットなので露出しても問題ない */
  fullPath?: string;
  thumbPath?: string;
}

export interface Post {
  id: UUID;
  userId: UUID;
  spotId: UUID;
  comment: string;
  category: Category;
  stayDuration: StayDuration | null;
  likeCount: number;
  status: PostStatus;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/** 画面に出す投稿（作者・画像・スポット名つき） */
export interface PostView extends Post {
  author: { id: UUID; displayName: string; avatarUrl: string | null };
  spotName: string;
  images: PostImageView[];
  /** 閲覧者がいいね済みか（未ログインなら false） */
  likedByMe: boolean;
}

// ---------- アップロード ----------
export type UploadKind = "full" | "thumb";

export interface UploadRequestFile {
  kind: UploadKind;
  contentType: string;
  size: number;
}

export interface UploadTarget {
  kind: UploadKind;
  /** Storage 上の一時パス（posts/tmp/{userId}/...） */
  path: string;
  /** ブラウザが PUT する URL */
  signedUrl: string;
}

export interface UploadsResponse {
  uploads: UploadTarget[];
}

// ---------- 行きたい場所リスト ----------
export interface Wishlist {
  id: UUID;
  userId: UUID;
  name: string;
  shareToken: string | null;
  createdAt: ISODateTime;
  itemCount: number;
}

export interface WishlistItem {
  spotId: UUID;
  mustVisit: boolean;
  createdAt: ISODateTime;
  /** 削除されたスポットは null（F-4 例外） */
  spot: SpotSummary | null;
}

export interface WishlistDetail extends Wishlist {
  items: WishlistItem[];
  plans: PlanSummary[];
}

export interface SharedWishlist {
  name: string;
  ownerDisplayName: string;
  items: WishlistItem[];
}

// ---------- 経路プラン ----------
export interface LatLng {
  lat: number;
  lng: number;
}

export interface PlanPlace extends LatLng {
  label: string;
}

export interface PlanParams {
  listId: UUID;
  spotIds: UUID[];
  origin: PlanPlace;
  destination: PlanPlace | null;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM */
  startTime: string;
  endTime: string;
  mode: TravelMode;
  pace: Pace;
  interests: Interest[];
  lunchBreak: boolean;
}

export type PlanItem =
  | {
      type: "spot";
      spotId: UUID;
      arrive: string;
      stayMin: number;
      depart: string;
      travelMinToNext: number | null;
      inBestTime: boolean;
    }
  | { type: "lunch"; arrive: string; stayMin: number; depart: string; travelMinToNext: number | null };

export type SkipReason = "time_limit" | "no_route" | "deleted" | "opening_hours";

export interface PlanResult {
  items: PlanItem[];
  skipped: { spotId: UUID; reason: SkipReason }[];
  totalTravelMin: number;
  /** 最後の地点を出発する時刻、または到着地に着く時刻 */
  endAt: string;
  geometry: { type: "LineString"; coordinates: [number, number][] } | null;
  travelMatrixId: string;
  /** 外部 API が使えず直線距離で概算したとき true */
  estimated: boolean;
}

export interface PlanSummary {
  id: UUID;
  wishlistId: UUID;
  date: string;
  spotCount: number;
  totalTravelMin: number;
  createdAt: ISODateTime;
}

export interface Plan extends PlanSummary {
  userId: UUID;
  params: PlanParams;
  result: PlanResult;
}

// ---------- 通報 ----------
export type ReportStatus = "open" | "resolved";

export interface Report {
  id: UUID;
  postId: UUID;
  reporterId: UUID;
  reason: ReportReason;
  note: string | null;
  status: ReportStatus;
  createdAt: ISODateTime;
}

// ---------- 無料枠 ----------
export interface ApiUsage {
  provider: string;
  feature: Feature;
  /** `2026-10`（月）または `2026-10-10`（日） */
  period: string;
  count: number;
  limit: number;
  suspendedAt: ISODateTime | null;
}

export interface SuspendedFeature {
  feature: Feature;
  provider: string;
  period: string;
  count: number;
  limit: number;
  suspendedAt: ISODateTime;
}

/** GET /system/status */
export interface SystemStatus {
  suspended: SuspendedFeature[];
  /** 外部サービスが設定されているか（未設定なら代替動作） */
  capabilities: {
    externalSearch: boolean;
    routing: boolean;
    googleLogin: boolean;
    backend: "memory" | "supabase";
  };
}

// ---------- 移動時間キャッシュ ----------
export interface TravelTimeEntry {
  fromKey: string;
  toKey: string;
  mode: TravelMode;
  durationSec: number;
  distanceM: number;
  fetchedAt: ISODateTime;
}

// ---------- 共通 ----------
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
}

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMITED"
  | "UPSTREAM_ERROR"
  | "FEATURE_SUSPENDED"
  | "INTERNAL_ERROR";

/** 外部の場所検索（Nominatim）の結果 */
export interface PlaceCandidate {
  source: "db" | "external";
  /** 自前DBのスポットなら spotId、外部なら externalRef */
  id: string;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  prefecture: string | null;
  city: string | null;
}

export interface PlacesSearchResponse {
  results: PlaceCandidate[];
  /** 外部検索が停止中・未設定で自前DBのみの結果なら true */
  externalUnavailable: boolean;
}
