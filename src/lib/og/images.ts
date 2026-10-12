import "server-only";
import { serverConfig } from "@/lib/config";

/**
 * OGP 画像の背景に使う写真を fetch して data URI にする。
 * - 相対 URL（memory モードの /api/dev/files/…、/seed/photos/…）は serverConfig.siteUrl を基準に絶対 URL へ。
 * - 失敗・形式不明・大きすぎる場合は null（呼び出し側は写真なしのレイアウト）。
 */
const TIMEOUT_MS = 4_000;
const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"]);

export function absoluteImageUrl(url: string): string {
  return new URL(url, serverConfig.siteUrl).toString();
}

export async function fetchImageDataUri(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(absoluteImageUrl(url), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!ALLOWED.has(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return null;
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch (err) {
    console.warn("[og] 写真の取得に失敗しました", err instanceof Error ? err.message : err);
    return null;
  }
}
