/**
 * POST /posts・PATCH /posts/{id} の 400 VALIDATION_ERROR のうち、一時アップロードが期限切れ・不正
 * （details に field: "images" の項目がある。src/lib/services/posts.ts の upload_missing / invalid_path）
 * かどうかを判定する。該当する場合は保持している tmp パスを捨て、再試行で写真を再アップロードする。
 */
import { ApiClientError } from "@/lib/api/client";

export function hasImageIssue(details: unknown): boolean {
  if (!Array.isArray(details)) return false;
  return details.some(
    (d) => typeof d === "object" && d !== null && (d as { field?: unknown }).field === "images",
  );
}

export function isImageUploadError(err: unknown): boolean {
  return err instanceof ApiClientError && err.code === "VALIDATION_ERROR" && hasImageIssue(err.details);
}

export const UPLOAD_EXPIRED_MESSAGE =
  "写真のアップロードが期限切れか無効です。再試行すると写真をもう一度アップロードします";
