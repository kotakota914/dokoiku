/**
 * アプリ全体で共有する定数。要件定義書（docs/要件定義書.md）の数値をここに集約する。
 * 画面・API・Repository のどこからも import してよい（ブラウザでも動く純粋な値のみ）。
 */

export const CATEGORIES = ["nature", "gourmet", "history", "photogenic", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  nature: "自然",
  gourmet: "グルメ",
  history: "歴史・文化",
  photogenic: "写真映え",
  other: "その他",
};

/** Lucide のアイコン名（8.1 の対応表）。コンポーネント側で lucide-react の実体に対応づける */
export const CATEGORY_ICONS: Record<Category, "trees" | "utensils" | "landmark" | "aperture" | "map-pin"> = {
  nature: "trees",
  gourmet: "utensils",
  history: "landmark",
  photogenic: "aperture",
  other: "map-pin",
};

/** 11章：投稿が3件未満のときに使う滞在時間の標準値（分）。Q9 の推奨どおり */
export const CATEGORY_DEFAULT_STAY_MIN: Record<Category, number> = {
  nature: 60,
  gourmet: 60,
  history: 45,
  photogenic: 30,
  other: 45,
};

export const STAY_DURATIONS = ["lt30", "lt60", "lt120", "half_day"] as const;
export type StayDuration = (typeof STAY_DURATIONS)[number];

export const STAY_DURATION_LABELS: Record<StayDuration, string> = {
  lt30: "〜30分",
  lt60: "〜1時間",
  lt120: "〜2時間",
  half_day: "半日以上",
};

/** 11章：滞在時間の選択肢を分に換算する値 */
export const STAY_DURATION_MINUTES: Record<StayDuration, number> = {
  lt30: 30,
  lt60: 60,
  lt120: 120,
  half_day: 240,
};

export const POPULARITY_LEVELS = ["normal", "popular", "very_popular"] as const;
export type Popularity = (typeof POPULARITY_LEVELS)[number];

export const POPULARITY_LABELS: Record<Popularity, string> = {
  normal: "通常",
  popular: "人気",
  very_popular: "大人気",
};

/** Q11：人気度のしきい値（投稿数） */
export const POPULARITY_THRESHOLDS = { popular: 5, veryPopular: 20 } as const;

export function popularityOf(postCount: number): Popularity {
  if (postCount >= POPULARITY_THRESHOLDS.veryPopular) return "very_popular";
  if (postCount >= POPULARITY_THRESHOLDS.popular) return "popular";
  return "normal";
}

/** F-1-3：ズームレベルによる表示方式の境界 */
export const MAP_ZOOM = {
  heatmapMax: 8, // ズーム8以下：ヒートマップ
  clusterMin: 9, // 9〜13：写真の束
  clusterMax: 13,
  pinMin: 14, // 14以上：写真ピン
  initialWithLocation: 13,
  initialWithoutLocation: 5,
} as const;

export type MapMode = "heatmap" | "cluster" | "pins";

/**
 * ズームから表示方式を決める。MapLibre のズームは連続値なので、GET /spots に送る整数ズーム
 * （useViewportSpots の Math.round）と同じ丸めで判定し、画面とサーバーの方式がずれないようにする。
 */
export function mapModeForZoom(zoom: number): MapMode {
  const z = Math.round(zoom);
  if (z <= MAP_ZOOM.heatmapMax) return "heatmap";
  if (z >= MAP_ZOOM.pinMin) return "pins";
  return "cluster";
}

/** 日本全体を映す初期ビュー（位置情報が拒否されたとき） */
export const JAPAN_CENTER = { lat: 36.2, lng: 138.25 } as const;

/** F-1-4：写真の束の重なり枚数とサイズ（px）の3段階 */
export const CLUSTER_STYLE = [
  { maxPosts: 4, layers: 1, size: 48 },
  { maxPosts: 19, layers: 2, size: 64 },
  { maxPosts: Infinity, layers: 3, size: 80 },
] as const;

export const PIN_THUMB_SIZE = 48;

export const LIMITS = {
  /** F-1-2 */
  mapFetchDebounceMs: 300,
  /** GET /spots の1回あたり最大件数 */
  mapMaxSpots: 2000,
  /** F-2-3 */
  postImagesMin: 1,
  postImagesMax: 4,
  originalImageMaxBytes: 10 * 1024 * 1024,
  /** POST /uploads：変換後の1枚あたり上限 */
  convertedImageMaxBytes: 2 * 1024 * 1024,
  imageFullLongEdge: 1600,
  imageThumbLongEdge: 400,
  /** F-2-8 */
  commentMax: 150,
  spotNameMin: 1,
  spotNameMax: 50,
  /** F-2-6 */
  nearbyRadiusDefaultM: 100,
  nearbyRadiusMaxM: 300,
  nearbyMax: 10,
  /** GPS 誤差がこれ以上なら新規スポット登録不可 */
  gpsAccuracyMaxM: 100,
  /** POST /posts：同名スポットの重複判定半径 */
  duplicateSpotRadiusM: 50,
  /** F-3-2 */
  postsPageSize: 20,
  /** F-4-1, F-4-2 */
  listNameMin: 1,
  listNameMax: 30,
  listsPerUser: 20,
  itemsPerList: 30,
  /** F-5-2 */
  planSpotsMax: 10,
  /** F-6-2 */
  displayNameMin: 1,
  displayNameMax: 20,
  /** F-7-1 */
  reportNoteMax: 100,
  /** F-7-2（Q13） */
  reportAutoHideCount: 3,
  /** 9.1 利用制限 */
  postsPerMinute: 5,
  externalSearchPerSecond: 1,
  /** 11章：スポットの滞在時間中央値を使うのに必要な投稿数 */
  stayMedianMinPosts: 3,
  /** 11章：おすすめ時間帯を出すのに必要な投稿数 */
  bestHoursMinPosts: 5,
  /** travel_time_cache の有効期間 */
  travelCacheDays: 30,
  /** 一時アップロードの保持時間 */
  tmpUploadHours: 24,
} as const;

export const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
] as const;

export const TRAVEL_MODES = ["walking", "driving"] as const;
export type TravelMode = (typeof TRAVEL_MODES)[number];
export const TRAVEL_MODE_LABELS: Record<TravelMode, string> = { walking: "徒歩", driving: "車" };

export const PACES = ["relaxed", "normal", "packed"] as const;
export type Pace = (typeof PACES)[number];
export const PACE_LABELS: Record<Pace, string> = {
  relaxed: "ゆったり",
  normal: "ふつう",
  packed: "たくさん回りたい",
};
/** F-5-1：ペースの倍率 */
export const PACE_MULTIPLIER: Record<Pace, number> = { relaxed: 1.3, normal: 1.0, packed: 0.8 };

/** F-5-1：重視するもの（カテゴリ「その他」は選べない） */
export const INTERESTS = [
  "photogenic",
  "gourmet",
  "history",
  "nature",
] as const satisfies readonly Category[];
export type Interest = (typeof INTERESTS)[number];
/** 11章：重視するカテゴリの滞在時間倍率 */
export const INTEREST_MULTIPLIER = 1.2;

export const PLAN_DEFAULTS = {
  startTime: "09:00",
  endTime: "18:00",
  lunchWindowStart: "11:30",
  lunchWindowEnd: "13:30",
  lunchMinutes: 60,
  /** 11章：おすすめ時間帯から外れた分数に掛ける係数 */
  offBestHourPenalty: 0.5,
  /** 11章：全探索で扱う最大スポット数（それ以上は 2-opt） */
  exhaustiveMaxSpots: 8,
  /** 滞在時間の丸め単位（分） */
  stayRoundMinutes: 5,
} as const;

/** 外部 API が使えないときの移動時間の概算（km/h）と迂回係数 */
export const FALLBACK_SPEED_KMH: Record<TravelMode, number> = { walking: 4.5, driving: 30 };
export const FALLBACK_DETOUR_FACTOR = 1.3;

export const REPORT_REASONS = ["inappropriate_image", "wrong_place", "spam", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  inappropriate_image: "不適切な画像",
  wrong_place: "場所が違う",
  spam: "スパム",
  other: "その他",
};

/** F-8：無料枠で停止の対象になる機能 */
export const FEATURES = ["external_search", "route_planning", "post_create"] as const;
export type Feature = (typeof FEATURES)[number];
export const FEATURE_LABELS: Record<Feature, string> = {
  external_search: "外部の場所検索",
  route_planning: "経路作成",
  post_create: "スポット投稿（写真アップロード）",
};

/** 14章：外部サービスの無料枠（数値は 2026/10 時点の想定。公式サイトで確認して更新する） */
export const USAGE_LIMITS = {
  ors_directions: {
    provider: "ors",
    feature: "route_planning" as Feature,
    period: "day" as const,
    limit: 2000,
  },
  ors_matrix: { provider: "ors", feature: "route_planning" as Feature, period: "day" as const, limit: 500 },
  nominatim: {
    provider: "nominatim",
    feature: "external_search" as Feature,
    period: "day" as const,
    limit: 500,
  },
  supabase_storage: {
    provider: "supabase_storage",
    feature: "post_create" as Feature,
    period: "month" as const,
    limit: 1024 * 1024 * 1024,
  },
  supabase_db: {
    provider: "supabase_db",
    feature: "post_create" as Feature,
    period: "month" as const,
    limit: 500 * 1024 * 1024,
  },
} as const;
export type UsageKey = keyof typeof USAGE_LIMITS;

/** ADR-0008：無料枠のこの割合に達したら停止する */
export const USAGE_SUSPEND_RATIO = 0.8;

export const STORAGE_BUCKET = "post-images";

/** 共通で使うタイムゾーン（投稿時刻の分布・経路の時刻計算はすべて日本時間） */
export const TIME_ZONE = "Asia/Tokyo";
export const TZ_OFFSET = "+09:00";
