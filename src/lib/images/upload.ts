"use client";

/**
 * 変換済み画像のアップロード（F-2-4、ADR-0019）。
 * POST /api/v1/uploads で署名付き URL を受け取り、各 URL に PUT する。
 * 失敗したら ApiClientError または Error を投げる（呼び出し側で「再試行」を出す）。
 */
import { api } from "@/lib/api/client";
import type { UploadRequestFile, UploadTarget, UploadsResponse } from "@/lib/domain/types";
import type { ConvertedImage } from "./convert";

export interface UploadedImage {
  fullPath: string;
  thumbPath: string;
  width: number;
  height: number;
}

export type UploadProgress = (done: number, total: number) => void;

export const UPLOAD_FAILED_MESSAGE = "写真のアップロードに失敗しました";

/** POST /uploads の files の並び：画像ごとに full, thumb の順 */
export function buildUploadRequest(converted: ReadonlyArray<ConvertedImage>): UploadRequestFile[] {
  return converted.flatMap((c) => [
    { kind: "full" as const, contentType: c.contentType, size: c.full.size },
    { kind: "thumb" as const, contentType: c.contentType, size: c.thumb.size },
  ]);
}

async function putBlob(target: UploadTarget, blob: Blob, contentType: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(target.signedUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: blob,
    });
  } catch {
    throw new Error(UPLOAD_FAILED_MESSAGE);
  }
  if (!res.ok) throw new Error(UPLOAD_FAILED_MESSAGE);
}

/**
 * 画像一式をアップロードし、POST /posts の images に渡す形で返す。
 * onProgress は PUT が 1 本終わるごとに (done, total) で呼ぶ。
 */
export async function uploadImages(
  converted: ReadonlyArray<ConvertedImage>,
  onProgress?: UploadProgress,
): Promise<UploadedImage[]> {
  if (converted.length === 0) return [];
  const files = buildUploadRequest(converted);
  const { uploads } = await api.post<UploadsResponse>("/uploads", { files });
  if (!Array.isArray(uploads) || uploads.length !== files.length) throw new Error(UPLOAD_FAILED_MESSAGE);

  const total = files.length;
  let done = 0;
  onProgress?.(0, total);

  const tasks: Promise<void>[] = [];
  const result: UploadedImage[] = converted.map((c, i) => {
    const full = uploads[i * 2];
    const thumb = uploads[i * 2 + 1];
    if (full.kind !== "full" || thumb.kind !== "thumb") throw new Error(UPLOAD_FAILED_MESSAGE);
    for (const [target, blob] of [
      [full, c.full],
      [thumb, c.thumb],
    ] as const) {
      tasks.push(
        putBlob(target, blob, c.contentType).then(() => {
          done += 1;
          onProgress?.(done, total);
        }),
      );
    }
    return { fullPath: full.path, thumbPath: thumb.path, width: c.width, height: c.height };
  });
  await Promise.all(tasks);
  return result;
}
