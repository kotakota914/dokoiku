/**
 * API 入力の zod スキーマ。クライアント（フォーム）とサーバー（Route Handler）で同じものを使う。
 * zod v4。メッセージは日本語。
 */
import { z } from "zod";
import {
  ACCEPTED_IMAGE_TYPES,
  CATEGORIES,
  INTERESTS,
  LIMITS,
  PACES,
  PLAN_METHODS,
  PRIORITIES,
  REPORT_REASONS,
  STAY_DURATIONS,
  TILE_ZOOMS,
  TRAVEL_MODES,
} from "@/lib/domain/constants";

export const uuidSchema = z.string().uuid("IDの形式が正しくありません");

export const latSchema = z.coerce.number().min(-90).max(90);
export const lngSchema = z.coerce.number().min(-180).max(180);

export const categorySchema = z.enum(CATEGORIES, { message: "カテゴリを選んでください" });
export const stayDurationSchema = z.enum(STAY_DURATIONS, { message: "滞在時間の値が正しくありません" });

const trimmed = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .min(min, `${label}を入力してください`)
    .max(max, `${label}は${max}文字以内で入力してください`);

// ---------- 地図・スポット ----------
export const bboxSchema = z.string().transform((s, ctx) => {
  const parts = s.split(",").map((v) => Number(v.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    ctx.addIssue({ code: "custom", message: "bbox は minLng,minLat,maxLng,maxLat の形式で指定してください" });
    return z.NEVER;
  }
  const [minLng, minLat, maxLng, maxLat] = parts;
  if (minLng > maxLng || minLat > maxLat || minLat < -90 || maxLat > 90 || minLng < -180 || maxLng > 180) {
    ctx.addIssue({ code: "custom", message: "bbox の範囲が正しくありません" });
    return z.NEVER;
  }
  return { minLng, minLat, maxLng, maxLat };
});

export const categoryListSchema = z
  .string()
  .optional()
  .transform((s, ctx) => {
    if (!s) return undefined;
    const list = s
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    const invalid = list.filter((v) => !(CATEGORIES as readonly string[]).includes(v));
    if (invalid.length) {
      ctx.addIssue({ code: "custom", message: `不明なカテゴリです: ${invalid.join(", ")}` });
      return z.NEVER;
    }
    return list as (typeof CATEGORIES)[number][];
  });

export const spotsInViewQuerySchema = z.object({
  bbox: bboxSchema,
  zoom: z.coerce.number().min(0).max(22),
  category: categoryListSchema,
});
export type SpotsInViewQuery = z.infer<typeof spotsInViewQuerySchema>;

export const nearbyQuerySchema = z.object({
  lat: latSchema,
  lng: lngSchema,
  /** GPS 誤差（メートル）。省略時は誤差不明として canCreate: false にする（Q7） */
  accuracy: z.coerce.number().min(0).max(100_000).optional(),
  radius: z.coerce.number().min(1).max(LIMITS.nearbyRadiusMaxM).default(LIMITS.nearbyRadiusDefaultM),
});
export type NearbyQuery = z.infer<typeof nearbyQuerySchema>;

export const spotSearchQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  prefecture: z.string().trim().max(20).optional(),
  city: z.string().trim().max(30).optional(),
  category: categorySchema.optional(),
  sort: z.enum(["popular", "newest"]).default("popular"),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SpotSearchQuery = z.infer<typeof spotSearchQuerySchema>;

export const placesSearchQuerySchema = z.object({
  q: trimmed(1, 100, "検索語"),
  /** 現在地があれば近い順の参考に使う */
  lat: latSchema.optional(),
  lng: lngSchema.optional(),
});

export const pagingQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(LIMITS.postsPageSize),
});

// ---------- アップロード ----------
export const uploadRequestSchema = z.object({
  files: z
    .array(
      z.object({
        kind: z.enum(["full", "thumb"]),
        contentType: z.enum(["image/webp", "image/jpeg"]),
        /** 上限（LIMITS.convertedImageMaxBytes）超過はスキーマではなく service で 413 PAYLOAD_TOO_LARGE にする（9.1） */
        size: z.number().int().positive(),
      }),
    )
    .min(1)
    .max(LIMITS.postImagesMax * 2),
});
export type UploadRequest = z.infer<typeof uploadRequestSchema>;

// ---------- 投稿 ----------
export const postImageInputSchema = z.object({
  fullPath: z.string().min(1).max(300),
  thumbPath: z.string().min(1).max(300),
  width: z.number().int().positive().max(10_000),
  height: z.number().int().positive().max(10_000),
});

export const newSpotInputSchema = z.object({
  name: trimmed(LIMITS.spotNameMin, LIMITS.spotNameMax, "スポット名"),
  lat: latSchema,
  lng: lngSchema,
  source: z.enum(["gps", "search_external"]),
  accuracyM: z.number().min(0).optional(),
  externalRef: z.string().max(100).optional(),
  address: z.string().max(200).optional(),
  prefecture: z.string().max(20).optional(),
  city: z.string().max(30).optional(),
});
export type NewSpotInput = z.infer<typeof newSpotInputSchema>;

const postBodyBase = {
  images: z
    .array(postImageInputSchema)
    .min(LIMITS.postImagesMin, "写真を1枚以上選んでください")
    .max(LIMITS.postImagesMax, `写真は${LIMITS.postImagesMax}枚までです`),
  comment: z
    .string()
    .trim()
    .max(LIMITS.commentMax, `コメントは${LIMITS.commentMax}文字以内で入力してください`)
    .default(""),
  category: categorySchema,
  stayDuration: stayDurationSchema.nullable().default(null),
};

export const createPostSchema = z
  .object({
    spotId: uuidSchema.optional(),
    newSpot: newSpotInputSchema.optional(),
    ...postBodyBase,
  })
  .refine((v) => Boolean(v.spotId) !== Boolean(v.newSpot), {
    message: "spotId か newSpot のどちらか一方を指定してください",
    path: ["spotId"],
  })
  .refine(
    (v) =>
      !v.newSpot || v.newSpot.source !== "gps" || (v.newSpot.accuracyM ?? Infinity) < LIMITS.gpsAccuracyMaxM,
    {
      message: "位置の誤差が大きいため、候補から選んでください",
      path: ["newSpot", "accuracyM"],
    },
  );
export type CreatePostInput = z.infer<typeof createPostSchema>;

export const updatePostSchema = z.object({
  images: postBodyBase.images.optional(),
  comment: postBodyBase.comment.optional(),
  category: categorySchema.optional(),
  stayDuration: stayDurationSchema.nullable().optional(),
});
export type UpdatePostInput = z.infer<typeof updatePostSchema>;

export const createReportSchema = z.object({
  reason: z.enum(REPORT_REASONS),
  note: z
    .string()
    .trim()
    .max(LIMITS.reportNoteMax, `${LIMITS.reportNoteMax}文字以内で入力してください`)
    .optional(),
});

// ---------- プロフィール ----------
export const displayNameSchema = trimmed(LIMITS.displayNameMin, LIMITS.displayNameMax, "表示名");

export const AVATAR_URL_MESSAGE = "アイコンは https:// から始まる URL を入力してください";

/** アイコン URL は https のみ（http: は混在コンテンツ、javascript:/data: は危険なため） */
export const avatarUrlSchema = z
  .string()
  .url(AVATAR_URL_MESSAGE)
  .max(500, AVATAR_URL_MESSAGE)
  .refine((v) => v.startsWith("https://"), AVATAR_URL_MESSAGE);

export const updateProfileSchema = z.object({
  displayName: displayNameSchema.optional(),
  avatarUrl: avatarUrlSchema.nullable().optional(),
});

// ---------- リスト ----------
export const listNameSchema = trimmed(LIMITS.listNameMin, LIMITS.listNameMax, "リスト名");
export const createListSchema = z.object({ name: listNameSchema });
export const renameListSchema = z.object({ name: listNameSchema });
/** PATCH /lists/{listId}：名前と拠点（F-4-8）。拠点は label + location の両方、または null で解除 */
export const listBaseSchema = z.object({
  label: z.string().trim().min(1, "拠点の名前を入力してください").max(100, "拠点の名前は100文字以内で入力してください"),
  location: z.object({ lat: latSchema, lng: lngSchema }),
});
export const updateListSchema = z
  .object({
    name: listNameSchema.optional(),
    base: listBaseSchema.nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.base !== undefined, { message: "変更する項目がありません" });
export type UpdateListInput = z.infer<typeof updateListSchema>;
/** GET /lists/{listId} の並び順（F-4-9） */
export const listItemsSortSchema = z.enum(["added", "distance", "popular"]).default("added");
export const addListItemSchema = z.object({ spotId: uuidSchema });
export const setMustVisitSchema = z.object({ mustVisit: z.boolean() });

// ---------- 経路プラン ----------
export const timeHHMMSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "時刻は HH:MM の形式で入力してください");
/** YYYY-MM-DD が実在する日付か（2026-02-30 のような繰り上がりも不可） */
export function isValidYMD(ymd: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

export const dateYMDSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日付は YYYY-MM-DD の形式で入力してください")
  .refine(isValidYMD, "存在する日付を入力してください");

export const planPlaceSchema = z.object({
  lat: latSchema,
  lng: lngSchema,
  label: z.string().trim().max(100).default(""),
});

/** F-5-4 / F-5-5：条件。おまかせでは初期値のまま */
export const planPreferencesSchema = z.object({
  pace: z.enum(PACES).default("normal"),
  interests: z.array(z.enum(INTERESTS)).max(INTERESTS.length).default([]),
  priority: z.enum(PRIORITIES).default("fewer_moves"),
  timeWindows: z
    .array(
      z
        .object({ spotId: uuidSchema, from: timeHHMMSchema, to: timeHHMMSchema })
        .refine((w) => w.from < w.to, { message: "時刻の範囲が正しくありません", path: ["to"] }),
    )
    .max(LIMITS.planSpotsMax)
    .default([]),
  orderHints: z
    .array(
      z.object({
        spotId: uuidSchema,
        position: z.enum(["first", "last", "before", "after"]),
        relativeTo: uuidSchema.optional(),
      }),
    )
    .max(LIMITS.planSpotsMax)
    .default([]),
  exclude: z.array(uuidSchema).max(LIMITS.planSpotsMax).default([]),
});
export type PlanPreferencesInput = z.infer<typeof planPreferencesSchema>;

export const planComputeSchema = z
  .object({
    listId: uuidSchema,
    spotIds: z
      .array(uuidSchema)
      .min(1, "スポットを1つ以上選んでください")
      .max(LIMITS.planSpotsMax, `スポットは${LIMITS.planSpotsMax}か所までです`),
    origin: planPlaceSchema,
    destination: planPlaceSchema.nullable().default(null),
    date: dateYMDSchema,
    startTime: timeHHMMSchema,
    endTime: timeHHMMSchema,
    mode: z.enum(TRAVEL_MODES).default("transit"),
    lunchBreak: z.boolean().default(false),
    method: z.enum(PLAN_METHODS).default("auto"),
    preferences: planPreferencesSchema.default({
      pace: "normal",
      interests: [],
      priority: "fewer_moves",
      timeWindows: [],
      orderHints: [],
      exclude: [],
    }),
  })
  .refine((v) => v.startTime < v.endTime, {
    message: "終了時刻は開始時刻より後にしてください",
    path: ["endTime"],
  });
export type PlanComputeInput = z.infer<typeof planComputeSchema>;

/** POST /plans/chat：AIと相談（F-5-5）。会話は最大 chatMaxTurns 往復 */
export const planChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(1000, "メッセージは1000文字以内で入力してください"),
});
export const planChatSchema = z.object({
  listId: uuidSchema,
  spotIds: z.array(uuidSchema).min(1).max(LIMITS.planSpotsMax),
  date: dateYMDSchema,
  startTime: timeHHMMSchema,
  endTime: timeHHMMSchema,
  mode: z.enum(TRAVEL_MODES).default("transit"),
  messages: z
    .array(planChatMessageSchema)
    .min(1, "メッセージを入力してください")
    .max(LIMITS.chatMaxTurns * 2, `会話は${LIMITS.chatMaxTurns}往復までです`),
  /** これまでに読み取った条件（続きの会話で上書きしていく） */
  conditions: planPreferencesSchema.optional(),
});
export type PlanChatInput = z.infer<typeof planChatSchema>;

/** 並び替え・滞在時間変更後の再計算。外部 API は呼ばない */
export const planRecomputeSchema = z.object({
  params: planComputeSchema,
  travelMatrixId: z.string().min(1).max(200),
  order: z.array(uuidSchema).min(1).max(LIMITS.planSpotsMax),
  stayOverrides: z.record(uuidSchema, z.number().int().min(5).max(600)).default({}),
  /** 調整する元の候補（id / kind / label を引き継ぐ）。省略時は c1 / fewest_moves /「調整した案」 */
  candidate: z
    .object({
      id: z.string().min(1).max(100),
      kind: z.enum(["fewest_moves", "most_spots", "best_time", "least_walking"]),
      label: z.string().trim().min(1).max(100),
    })
    .optional(),
});
export type PlanRecomputeInput = z.infer<typeof planRecomputeSchema>;

/** 保存するプランの項目（PlanItem と同じ形。滞在時間は 5〜600 分） */
const planStayMinSchema = z.number().int().min(5).max(600);
const planTravelMinSchema = z
  .number()
  .int()
  .min(0)
  .max(24 * 60)
  .nullable();
export const planLegSchema = z
  .object({
    mode: z.enum(TRAVEL_MODES),
    travelMin: z
      .number()
      .int()
      .min(0)
      .max(24 * 60),
    estimated: z.boolean().default(false),
    walkM: z.number().int().min(0).max(200_000).nullable().default(null),
  })
  .nullable();
export const planItemSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("spot"),
    spotId: uuidSchema,
    arrive: timeHHMMSchema,
    stayMin: planStayMinSchema,
    depart: timeHHMMSchema,
    travelMinToNext: planTravelMinSchema,
    next: planLegSchema.default(null),
    inBestTime: z.boolean(),
  }),
  z.object({
    type: z.literal("lunch"),
    arrive: timeHHMMSchema,
    stayMin: planStayMinSchema,
    depart: timeHHMMSchema,
    travelMinToNext: planTravelMinSchema,
    next: planLegSchema.default(null),
  }),
]);
export const skipReasonSchema = z.enum(["time_limit", "no_route", "deleted", "opening_hours", "excluded"]);
export const candidateKindSchema = z.enum(["fewest_moves", "most_spots", "best_time", "least_walking"]);
export const planStatsSchema = z.object({
  spotCount: z.number().int().min(0).max(LIMITS.planSpotsMax),
  totalTravelMin: z
    .number()
    .min(0)
    .max(24 * 60),
  walkM: z.number().min(0).max(1_000_000),
  endAt: timeHHMMSchema,
  bestTimeHits: z.number().int().min(0).max(LIMITS.planSpotsMax),
});
/** 経路線（GeoJSON LineString、[lng, lat]）。保存容量を抑えるため座標は最大 5000 点 */
export const routeGeometrySchema = z.object({
  type: z.literal("LineString"),
  coordinates: z.array(z.tuple([lngSchema, latSchema])).max(5000, "経路線の座標が多すぎます"),
});

/** 保存する1案（PlanResult と同じ形） */
export const planResultSchema = z.object({
  id: z.string().min(1).max(100),
  kind: candidateKindSchema,
  label: z.string().trim().min(1).max(100),
  reason: z.string().trim().max(500).default(""),
  /** スポット最大 LIMITS.planSpotsMax 件＋昼食 1 件。spotId が params.spotIds に含まれるかは service で確認する */
  items: z.array(planItemSchema).max(LIMITS.planSpotsMax + 1, "プランの項目が多すぎます"),
  skipped: z.array(z.object({ spotId: uuidSchema, reason: skipReasonSchema })).max(LIMITS.planSpotsMax),
  notes: z.array(z.string().trim().max(200)).max(10).default([]),
  stats: planStatsSchema,
  totalTravelMin: z
    .number()
    .min(0)
    .max(24 * 60),
  endAt: timeHHMMSchema,
  geometry: routeGeometrySchema.nullable(),
  travelMatrixId: z.string().min(1).max(200),
  estimated: z.boolean().default(false),
});
export const planSaveSchema = z.object({
  params: planComputeSchema,
  result: planResultSchema,
});
export type PlanSaveInput = z.infer<typeof planSaveSchema>;

// ---------- 地図タイル（F-1-2 / 9.3 GET /spots/tiles/{z}/{x}/{y}） ----------
/** z は TILE_ZOOMS（8 / 11 / 14）のいずれか。x, y は Web メルカトルのタイル番号（0 〜 2^z − 1） */
export const tilePathSchema = z
  .object({
    z: z.coerce
      .number()
      .int()
      .refine((v) => (TILE_ZOOMS as readonly number[]).includes(v), {
        message: `z は ${TILE_ZOOMS.join(", ")} のいずれかを指定してください`,
      }),
    x: z.coerce.number().int().min(0),
    y: z.coerce.number().int().min(0),
  })
  .refine((v) => v.x < 2 ** v.z && v.y < 2 ** v.z, { message: "タイル番号が範囲外です" });
export type TilePathInput = z.infer<typeof tilePathSchema>;
export const tileQuerySchema = z.object({
  category: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").map((v) => v.trim()).filter(Boolean) : undefined))
    .pipe(z.array(categorySchema).max(CATEGORIES.length).optional()),
});

// ---------- 管理 ----------
export const adminPostPatchSchema = z.object({ status: z.enum(["public", "hidden"]) });

// ---------- ブラウザ側の画像選択チェック（F-2-3） ----------
export function validateImageFile(file: { type: string; size: number; name: string }): string | null {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  const typeOk =
    (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type) ||
    (file.type === "" && ["jpg", "jpeg", "png", "heic", "heif", "webp"].includes(ext));
  if (!typeOk) return "JPEG / PNG / HEIC / WebP の画像を選んでください";
  if (file.size > LIMITS.originalImageMaxBytes) return "1枚あたり10MB以内の画像を選んでください";
  return null;
}
