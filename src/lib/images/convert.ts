/**
 * ブラウザ側の画像変換（F-2-4、ADR-0019）。
 * - 長辺 1600px の本画像と 400px のサムネイルを WebP（0.85）で再エンコードし、EXIF を除去する。
 * - WebP を出力できないブラウザ（古い Safari）では JPEG にフォールバックする。
 * - HEIC / HEIF は heic2any（dynamic import）で JPEG にしてから処理する。
 * - 変換後の本画像が 2MB を超えたら品質を 0.7 → 0.55 と下げて再試行する。
 *
 * window / document に依存するためブラウザでしか動かない。SSR では呼ばない。
 */
import { LIMITS } from "@/lib/domain/constants";

export type ConvertedContentType = "image/webp" | "image/jpeg";

export interface ConvertedImage {
  full: Blob;
  thumb: Blob;
  /** 本画像の幅・高さ（px） */
  width: number;
  height: number;
  contentType: ConvertedContentType;
}

/** 本画像の品質。2MB を超えたら順に下げる */
export const QUALITY_STEPS = [0.85, 0.7, 0.55] as const;

const HEIC_TYPES = ["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"];

/** HEIC / HEIF かどうか（type が空でも拡張子で判定する） */
export function isHeic(file: { type: string; name: string }): boolean {
  if (HEIC_TYPES.includes(file.type.toLowerCase())) return true;
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  return ext === "heic" || ext === "heif";
}

/** 長辺が maxLongEdge に収まるように縮小した寸法（拡大はしない。最小 1px） */
export function fitLongEdge(
  width: number,
  height: number,
  maxLongEdge: number,
): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxLongEdge)
    return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  const ratio = maxLongEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

export class ImageConvertError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageConvertError";
  }
}

const MESSAGES = {
  decode: "この画像を読み込めませんでした。別の写真を選んでください",
  heic: "HEIC 画像の変換に失敗しました。別の形式の写真を選んでください",
  encode: "画像の変換に失敗しました",
  tooLarge: "画像を2MB以内に変換できませんでした。別の写真を選んでください",
} as const;

type DecodedSource = ImageBitmap | HTMLImageElement;

async function heicToJpeg(file: Blob): Promise<Blob> {
  try {
    const mod = await import("heic2any");
    const heic2any = mod.default;
    const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
    const blob = Array.isArray(out) ? out[0] : out;
    if (!blob) throw new Error("empty");
    return blob;
  } catch {
    throw new ImageConvertError(MESSAGES.heic);
  }
}

/** 画像をデコードする。createImageBitmap が無ければ <img> で代替する */
async function decode(blob: Blob): Promise<DecodedSource> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob, { imageOrientation: "from-image" });
    } catch {
      // 古いブラウザはオプション未対応で失敗することがあるので、オプション無しで再挑戦する
      try {
        return await createImageBitmap(blob);
      } catch {
        // <img> にフォールバック
      }
    }
  }
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ImageConvertError(MESSAGES.decode));
    };
    img.src = url;
  });
}

function sizeOf(src: DecodedSource): { width: number; height: number } {
  if ("naturalWidth" in src) return { width: src.naturalWidth, height: src.naturalHeight };
  return { width: src.width, height: src.height };
}

function drawScaled(src: DecodedSource, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageConvertError(MESSAGES.encode);
  ctx.drawImage(src, 0, 0, width, height);
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: ConvertedContentType, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new ImageConvertError(MESSAGES.encode));
        },
        type,
        quality,
      );
    } catch {
      reject(new ImageConvertError(MESSAGES.encode));
    }
  });
}

/**
 * 選択されたファイルをアップロード用の 2 サイズに変換する。
 * 失敗時は ImageConvertError（画面にそのまま出せる文言）を投げる。
 */
export async function convertForUpload(file: File): Promise<ConvertedImage> {
  const source: Blob = isHeic(file) ? await heicToJpeg(file) : file;
  let decoded: DecodedSource;
  try {
    decoded = await decode(source);
  } catch (err) {
    if (err instanceof ImageConvertError) throw err;
    throw new ImageConvertError(MESSAGES.decode);
  }

  try {
    const { width: srcW, height: srcH } = sizeOf(decoded);
    if (!srcW || !srcH) throw new ImageConvertError(MESSAGES.decode);
    const fullSize = fitLongEdge(srcW, srcH, LIMITS.imageFullLongEdge);
    const thumbSize = fitLongEdge(srcW, srcH, LIMITS.imageThumbLongEdge);
    const fullCanvas = drawScaled(decoded, fullSize.width, fullSize.height);
    const thumbCanvas = drawScaled(decoded, thumbSize.width, thumbSize.height);

    // WebP を試し、出力の type が違えば（非対応ブラウザ）JPEG に切り替える
    let contentType: ConvertedContentType = "image/webp";
    let full = await canvasToBlob(fullCanvas, "image/webp", QUALITY_STEPS[0]);
    if (full.type !== "image/webp") {
      contentType = "image/jpeg";
      full = await canvasToBlob(fullCanvas, "image/jpeg", QUALITY_STEPS[0]);
    }
    for (let i = 1; i < QUALITY_STEPS.length && full.size > LIMITS.convertedImageMaxBytes; i += 1) {
      full = await canvasToBlob(fullCanvas, contentType, QUALITY_STEPS[i]);
    }
    if (full.size > LIMITS.convertedImageMaxBytes) throw new ImageConvertError(MESSAGES.tooLarge);

    const thumb = await canvasToBlob(thumbCanvas, contentType, QUALITY_STEPS[0]);
    return { full, thumb, width: fullSize.width, height: fullSize.height, contentType };
  } finally {
    if ("close" in decoded && typeof decoded.close === "function") decoded.close();
  }
}
