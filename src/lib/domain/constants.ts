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
/**
 * v0.3 F-1-5：人気度は市区町村内の投稿数の相対順位で決める。
 * 上位10%＝大人気、上位10〜30%＝人気。スポット10件未満の市区町村は都道府県単位。投稿1件は常に通常。
 */
export const POPULARITY_RANKING = {
  veryPopularRatio: 0.1,
  popularRatio: 0.3,
  minPostsForRank: 2,
  minSpotsForCity: 10,
} as const;

/** @deprecated v0.1 の件数しきい値。順位が未計算のときの代替にのみ使う */
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

/** v0.3 Q4（B）：MVP の間は位置情報が拒否されたとき金沢市中心部（ズーム13）を初期表示にする */
export const DEFAULT_VIEW = { center: { lat: 36.5613, lng: 136.6562 }, zoom: 13 } as const;
export const USE_DEFAULT_VIEW_WHEN_DENIED = true;

/** v0.3 F-1-2 / 9.3：地図用タイル API の取得ズーム段階と1区画あたりの上限 */
export const TILE_ZOOMS = [8, 11, 14] as const;
export const TILE_MAX_SPOTS = 500;
export const TILE_CACHE_MAX_AGE_SEC = 60;
/** 表示方式の切り替え時の透明度アニメーション（秒） */
export const MAP_MODE_FADE_SEC = 0.3;

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
  /** v0.3 F-5-1：経路作成の対象は最大8か所 */
  planSpotsMax: 8,
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
  /** 9.1 利用制限：経路作成 3回/分、AIとの相談 5回/分、会話は最大10往復 */
  plansPerMinute: 3,
  chatPerMinute: 5,
  chatMaxTurns: 10,
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

/** v0.3 F-5-2：移動手段。初期値は公共交通＋徒歩 */
export const TRAVEL_MODES = ["transit", "walking", "driving"] as const;
export type TravelMode = (typeof TRAVEL_MODES)[number];
export const TRAVEL_MODE_LABELS: Record<TravelMode, string> = {
  transit: "公共交通＋徒歩",
  walking: "徒歩のみ",
  driving: "車",
};
export const TRAVEL_MODE_DEFAULT: TravelMode = "transit";
/** Google マップの道案内 URL の travelmode */
export const GOOGLE_TRAVEL_MODE: Record<TravelMode, "transit" | "walking" | "driving"> = {
  transit: "transit",
  walking: "walking",
  driving: "driving",
};

/** v0.3 F-5-B：経路の作り方 */
export const PLAN_METHODS = ["auto", "preferences", "chat"] as const;
export type PlanMethod = (typeof PLAN_METHODS)[number];
export const PLAN_METHOD_LABELS: Record<PlanMethod, string> = {
  auto: "おまかせ",
  preferences: "重視するものを選ぶ",
  chat: "AIと相談",
};

/** v0.3 F-5-4 / 11.3：優先すること */
export const PRIORITIES = ["fewer_moves", "more_spots", "best_time", "less_walking"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = {
  fewer_moves: "移動を少なく",
  more_spots: "たくさん回る",
  best_time: "おすすめの時間帯に合わせる",
  less_walking: "歩く距離を少なく",
};
/**
 * 11.3 点数の重み（初期値。小さいほど良い）
 * 点数 = 合計移動時間(分)×a + おすすめ時間帯からのずれ(分)×b + 歩く距離(km)×c − 回れる場所の数×d
 */
export const PRIORITY_WEIGHTS: Record<Priority, { a: number; b: number; c: number; d: number }> = {
  fewer_moves: { a: 1.0, b: 0.3, c: 5, d: 30 },
  more_spots: { a: 0.5, b: 0.3, c: 3, d: 90 },
  best_time: { a: 0.7, b: 1.0, c: 3, d: 30 },
  less_walking: { a: 0.7, b: 0.3, c: 20, d: 30 },
};
export const PRIORITY_DEFAULT: Priority = "fewer_moves";

/** 11.4：複数案の種類 */
export const CANDIDATE_KINDS = ["fewest_moves", "most_spots", "best_time", "least_walking"] as const;
export type CandidateKind = (typeof CANDIDATE_KINDS)[number];
export const CANDIDATE_LABELS: Record<CandidateKind, string> = {
  fewest_moves: "移動が最も少ない案",
  most_spots: "回れる場所が最も多い案",
  best_time: "おすすめの時間帯に最も合う案",
  least_walking: "歩く距離が最も少ない案",
};
export const PLAN_CANDIDATES_MAX = 3;

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
  /** @deprecated 11.3 の重み b に置き換え。旧ロジック互換のため残す */
  offBestHourPenalty: 0.5,
  /** 11.2：訪問順は全通り（最大 8! 通り）。v0.3 では 8 か所が上限なので常に全探索 */
  exhaustiveMaxSpots: 8,
  /** 滞在時間の丸め単位（分） */
  stayRoundMinutes: 5,
} as const;

/** 外部 API が使えないときの移動時間の概算（km/h）と迂回係数 */
export const FALLBACK_SPEED_KMH: Record<TravelMode, number> = { transit: 15, walking: 4.5, driving: 30 };
export const FALLBACK_DETOUR_FACTOR = 1.3;
/** v0.3 Q2（B）：公共交通の概算に加える待ち時間（分） */
export const FALLBACK_TRANSIT_WAIT_MIN = 10;
/** 10.2 travel_time_cache：徒歩・車は30日、公共交通は7日で期限切れ */
export const TRAVEL_CACHE_DAYS: Record<TravelMode, number> = { transit: 7, walking: 30, driving: 30 };

export const REPORT_REASONS = ["inappropriate_image", "wrong_place", "spam", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  inappropriate_image: "不適切な画像",
  wrong_place: "場所が違う",
  spam: "スパム",
  other: "その他",
};

/** F-8：無料枠で停止の対象になる機能 */
export const FEATURES = [
  "external_search",
  "route_planning",
  "route_planning_transit",
  "ai_chat",
  "post_create",
] as const;
export type Feature = (typeof FEATURES)[number];
export const FEATURE_LABELS: Record<Feature, string> = {
  external_search: "外部の場所検索",
  route_planning: "経路作成（徒歩・車）",
  route_planning_transit: "経路作成（公共交通）",
  ai_chat: "AIと相談",
  post_create: "スポット投稿（写真アップロード）",
};

/** 14章：外部サービスの無料枠（数値は 2026/10 時点の想定。公式サイトで確認して更新する） */
export const USAGE_LIMITS = {
  /** ADR-0016：経路の形は取得しない。directions は使わない（互換のため残すが呼ばない） */
  ors_directions: {
    provider: "ors",
    feature: "route_planning" as Feature,
    period: "day" as const,
    limit: 2000,
  },
  ors_matrix: { provider: "ors", feature: "route_planning" as Feature, period: "day" as const, limit: 500 },
  /** Google Routes API（computeRouteMatrix、公共交通）。組み合わせ1件ごとに数える（F-8-1）。月の無料件数は要確認 */
  google_routes_transit: {
    provider: "google_routes",
    feature: "route_planning_transit" as Feature,
    period: "month" as const,
    limit: 10000,
  },
  /** Gemini API（AIと相談）。1日の回数上限は要確認 */
  gemini: { provider: "gemini", feature: "ai_chat" as Feature, period: "day" as const, limit: 1000 },
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
