/**
 * ドメイン型と API のレスポンス型。
 * - 「〜Row」は保存形（Repository が扱う）、それ以外は API・画面で使う形。
 * - 日時は ISO 8601 文字列（+09:00 付き）、座標は lat / lng（WGS84）。
 */
import type {
  CandidateKind,
  Category,
  Feature,
  Interest,
  Pace,
  PlanMethod,
  Popularity,
  Priority,
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
export type SpotSource = "gps" | "search_db" | "search_external" | "seed";

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
export type OpeningHours = Partial<
  Record<"0" | "1" | "2" | "3" | "4" | "5" | "6", { open: string; close: string } | null>
>;

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
  { mode: "spots"; spots: SpotSummary[] } | { mode: "heatmap"; points: HeatPoint[] };

/** v0.3 GET /spots/tiles/{z}/{x}/{y} も同じ形（z=8 はヒートマップ、それ以外はスポット）。区画→bbox 変換は src/lib/map/tiles.ts */

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
  /** v0.3 F-4-8：拠点（ホテル・駅など）。1リストに1つ */
  baseLabel: string | null;
  baseLocation: LatLng | null;
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

/** v0.3 F-5-4 / F-5-5：経路作成の条件（「AIと相談」の conditions も同じ形） */
export interface PlanPreferences {
  pace: Pace;
  interests: Interest[];
  priority: Priority;
  /** AIと相談：スポットごとの時刻の指定（例：金沢港は 16:00〜17:30 に到着） */
  timeWindows: { spotId: UUID; from: string; to: string }[];
  /** AIと相談：行く順番の希望 */
  orderHints: { spotId: UUID; position: "first" | "last" | "before" | "after"; relativeTo?: UUID }[];
  /** AIと相談：除外するスポット */
  exclude: UUID[];
}

export interface PlanParams {
  listId: UUID;
  /** 1〜8 件（F-5-1） */
  spotIds: UUID[];
  origin: PlanPlace;
  destination: PlanPlace | null;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM */
  startTime: string;
  endTime: string;
  mode: TravelMode;
  lunchBreak: boolean;
  method: PlanMethod;
  preferences: PlanPreferences;
}

/** 次の地点への移動（最後の項目は null） */
export interface PlanLeg {
  mode: TravelMode;
  travelMin: number;
  /** 直線距離からの概算なら true（公共交通は常に「目安」） */
  estimated: boolean;
  /** 徒歩の距離（m）。公共交通の徒歩部分を含む。不明なら null */
  walkM: number | null;
}

export type PlanItem =
  | {
      type: "spot";
      spotId: UUID;
      arrive: string;
      stayMin: number;
      depart: string;
      /** @deprecated next.travelMin を使う。互換のため残す */
      travelMinToNext: number | null;
      next: PlanLeg | null;
      inBestTime: boolean;
    }
  | {
      type: "lunch";
      arrive: string;
      stayMin: number;
      depart: string;
      travelMinToNext: number | null;
      next: PlanLeg | null;
    };

export type SkipReason = "time_limit" | "no_route" | "deleted" | "opening_hours" | "excluded";

export interface PlanStats {
  spotCount: number;
  totalTravelMin: number;
  /** 歩く距離（m） */
  walkM: number;
  endAt: string;
  /** おすすめの時間帯に合った場所の数 */
  bestTimeHits: number;
}

/** 経路案（1回の作成で最大3案。F-5-6） */
export interface PlanCandidate {
  id: string;
  kind: CandidateKind;
  label: string;
  /** なぜその案なのか（点数の内訳から作る） */
  reason: string;
  items: PlanItem[];
  skipped: { spotId: UUID; reason: SkipReason }[];
  /** 注意書き（例：「一部の区間は徒歩で計算しています」） */
  notes: string[];
  stats: PlanStats;
  /** 訪問順にスポットを結んだ線（実際の道の形ではない。ADR-0016） */
  geometry: { type: "LineString"; coordinates: [number, number][] } | null;
}

/** POST /plans/compute のレスポンス */
export interface PlanComputeResponse {
  candidates: PlanCandidate[];
  travelMatrixId: string;
  /** 全候補に共通の入らなかった場所（候補 0 件のときもどれが入らなかったかを返す）。各候補の skipped と同じ */
  skipped?: PlanCandidate["skipped"];
}

/** 保存する・再計算する1案。候補の内容＋行列ID */
export interface PlanResult extends PlanCandidate {
  totalTravelMin: number;
  /** 最後の地点を出発する時刻、または到着地に着く時刻（stats.endAt と同じ） */
  endAt: string;
  travelMatrixId: string;
  /** 一部でも概算の区間があれば true */
  estimated: boolean;
}

export interface PlanSummary {
  id: UUID;
  wishlistId: UUID;
  date: string;
  spotCount: number;
  totalTravelMin: number;
  method: PlanMethod;
  createdAt: ISODateTime;
}

export interface Plan extends PlanSummary {
  userId: UUID;
  params: PlanParams;
  result: PlanResult;
}

/** 保存済みプランの各区間の「ナビを開始」（F-5-12）。GET /plans/{planId} で付与 */
export interface PlanNavSegment {
  /** items のインデックス（出発地は -1） */
  fromIndex: number;
  toIndex: number;
  fromLabel: string;
  toLabel: string;
  navUrl: string;
}

export interface PlanWithNav extends Plan {
  segments: PlanNavSegment[];
}

/** POST /plans/chat */
export interface PlanChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface PlanChatResponse {
  reply: string;
  conditions: PlanPreferences;
  /** 読み取れなかったとき true（画面は選択式への切り替えを案内） */
  unclear: boolean;
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
    /** 徒歩・車の移動時間（OpenRouteService）が使えるか。false なら概算 */
    routing: boolean;
    /** 公共交通の移動時間（Google Routes API）が使えるか。false なら概算 */
    transit: boolean;
    /** AIと相談（Gemini）が使えるか */
    ai: boolean;
    googleLogin: boolean;
    backend: "memory" | "supabase";
  };
}

// ---------- 移動時間キャッシュ ----------
export interface TravelTimeEntry {
  fromKey: string;
  toKey: string;
  mode: TravelMode;
  /** 公共交通のみ使う出発時刻の区分（例 "weekday-09"）。徒歩・車は "any" */
  timeBucket: string;
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
