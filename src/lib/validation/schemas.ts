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
  REPORT_REASONS,
  STAY_DURATIONS,
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
export const bboxSchema = z
  .string()
  .transform((s, ctx) => {
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
    const list = s.split(",").map((v) => v.trim()).filter(Boolean);
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
  accuracy: z.coerce.number().min(0).max(100_000).default(0),
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
        size: z
          .number()
          .int()
          .positive()
          .max(LIMITS.convertedImageMaxBytes, "変換後の画像は1枚あたり2MB以内にしてください"),
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
  .refine((v) => !v.newSpot || v.newSpot.source !== "gps" || (v.newSpot.accuracyM ?? Infinity) < LIMITS.gpsAccuracyMaxM, {
    message: "位置の誤差が大きいため、候補から選んでください",
    path: ["newSpot", "accuracyM"],
  });
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
  note: z.string().trim().max(LIMITS.reportNoteMax, `${LIMITS.reportNoteMax}文字以内で入力してください`).optional(),
});

// ---------- プロフィール ----------
export const displayNameSchema = trimmed(LIMITS.displayNameMin, LIMITS.displayNameMax, "表示名");

export const updateProfileSchema = z.object({
  displayName: displayNameSchema.optional(),
  avatarUrl: z.string().url().max(500).nullable().optional(),
});

// ---------- リスト ----------
export const listNameSchema = trimmed(LIMITS.listNameMin, LIMITS.listNameMax, "リスト名");
export const createListSchema = z.object({ name: listNameSchema });
export const renameListSchema = z.object({ name: listNameSchema });
export const addListItemSchema = z.object({ spotId: uuidSchema });
export const setMustVisitSchema = z.object({ mustVisit: z.boolean() });

// ---------- 経路プラン ----------
export const timeHHMMSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "時刻は HH:MM の形式で入力してください");
export const dateYMDSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日付は YYYY-MM-DD の形式で入力してください");

export const planPlaceSchema = z.object({
  lat: latSchema,
  lng: lngSchema,
  label: z.string().trim().max(100).default(""),
});

export const planComputeSchema = z
  .object({
    listId: uuidSchema,
    spotIds: z.array(uuidSchema).min(1, "スポットを1つ以上選んでください").max(LIMITS.planSpotsMax, `スポットは${LIMITS.planSpotsMax}か所までです`),
    origin: planPlaceSchema,
    destination: planPlaceSchema.nullable().default(null),
    date: dateYMDSchema,
    startTime: timeHHMMSchema,
    endTime: timeHHMMSchema,
    mode: z.enum(TRAVEL_MODES),
    pace: z.enum(PACES).default("normal"),
    interests: z.array(z.enum(INTERESTS)).default([]),
    lunchBreak: z.boolean().default(false),
  })
  .refine((v) => v.startTime < v.endTime, { message: "終了時刻は開始時刻より後にしてください", path: ["endTime"] });
export type PlanComputeInput = z.infer<typeof planComputeSchema>;

/** 並び替え・滞在時間変更後の再計算。外部 API は呼ばない */
export const planRecomputeSchema = z.object({
  params: planComputeSchema,
  travelMatrixId: z.string().min(1).max(200),
  order: z.array(uuidSchema).min(1).max(LIMITS.planSpotsMax),
  stayOverrides: z.record(uuidSchema, z.number().int().min(5).max(600)).default({}),
});
export type PlanRecomputeInput = z.infer<typeof planRecomputeSchema>;

export const planSaveSchema = z.object({
  params: planComputeSchema,
  result: z.object({
    items: z.array(z.any()),
    skipped: z.array(z.object({ spotId: uuidSchema, reason: z.string() })),
    totalTravelMin: z.number(),
    endAt: timeHHMMSchema,
    geometry: z.any().nullable(),
    travelMatrixId: z.string(),
    estimated: z.boolean().default(false),
  }),
});
export type PlanSaveInput = z.infer<typeof planSaveSchema>;

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
