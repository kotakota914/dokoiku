// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIMITS } from "@/lib/domain/constants";

const heicMock = vi.fn();
vi.mock("heic2any", () => ({ default: heicMock }));

import { QUALITY_STEPS, convertForUpload, fitLongEdge, isHeic } from "./convert";

type ToBlobCall = { type: string; quality: number; width: number; height: number };

/** canvas を持たない jsdom 向けに getContext / toBlob / createImageBitmap を差し替える */
function setupCanvas(opts: {
  bitmap: { width: number; height: number };
  /** (type, quality, canvasWidth) → 出力 Blob。既定は小さい WebP */
  encode?: (type: string, quality: number, width: number) => Blob;
}) {
  const calls: ToBlobCall[] = [];
  const close = vi.fn();
  const createImageBitmap = vi.fn<
    (
      blob: Blob,
      options?: ImageBitmapOptions,
    ) => Promise<{ width: number; height: number; close: () => void }>
  >(async () => ({
    width: opts.bitmap.width,
    height: opts.bitmap.height,
    close,
  }));
  vi.stubGlobal("createImageBitmap", createImageBitmap);
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ({ drawImage }) as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    cb: BlobCallback,
    type?: string,
    quality?: unknown,
  ) {
    const t = type ?? "image/png";
    const q = typeof quality === "number" ? quality : 1;
    calls.push({ type: t, quality: q, width: this.width, height: this.height });
    const blob = opts.encode ? opts.encode(t, q, this.width) : new Blob([new Uint8Array(1000)], { type: t });
    cb(blob);
  });
  return { calls, close, createImageBitmap, drawImage };
}

function makeFile(name: string, type: string, size = 1000): File {
  return new File([new Uint8Array(size)], name, { type });
}

beforeEach(() => {
  heicMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("isHeic", () => {
  it("MIME タイプが image/heic または image/heif なら true", () => {
    expect(isHeic({ type: "image/heic", name: "a.jpg" })).toBe(true);
    expect(isHeic({ type: "image/heif", name: "a" })).toBe(true);
  });
  it("type が空でも拡張子 .heic / .heif なら true（大文字も可）", () => {
    expect(isHeic({ type: "", name: "IMG_0001.HEIC" })).toBe(true);
    expect(isHeic({ type: "", name: "photo.heif" })).toBe(true);
  });
  it("JPEG / PNG / WebP は false", () => {
    expect(isHeic({ type: "image/jpeg", name: "a.jpg" })).toBe(false);
    expect(isHeic({ type: "image/png", name: "a.png" })).toBe(false);
    expect(isHeic({ type: "image/webp", name: "heic-ish.webp" })).toBe(false);
  });
});

describe("fitLongEdge", () => {
  it("長辺を 1600 に縮小し、短辺も同じ比率で縮める（横長）", () => {
    expect(fitLongEdge(4000, 3000, LIMITS.imageFullLongEdge)).toEqual({ width: 1600, height: 1200 });
  });
  it("縦長は高さを長辺として扱う", () => {
    expect(fitLongEdge(3000, 4000, LIMITS.imageFullLongEdge)).toEqual({ width: 1200, height: 1600 });
  });
  it("長辺が上限以下なら拡大しない", () => {
    expect(fitLongEdge(800, 600, LIMITS.imageFullLongEdge)).toEqual({ width: 800, height: 600 });
  });
  it("サムネイルは長辺 400", () => {
    expect(fitLongEdge(4000, 3000, LIMITS.imageThumbLongEdge)).toEqual({ width: 400, height: 300 });
  });
});

describe("convertForUpload", () => {
  it("本画像 1600px とサムネイル 400px を WebP 0.85 で出力する", async () => {
    const { calls, close } = setupCanvas({ bitmap: { width: 4000, height: 3000 } });
    const out = await convertForUpload(makeFile("a.jpg", "image/jpeg"));
    expect(out.contentType).toBe("image/webp");
    expect(out.width).toBe(1600);
    expect(out.height).toBe(1200);
    expect(out.full.type).toBe("image/webp");
    expect(out.thumb.type).toBe("image/webp");
    expect(calls).toEqual([
      { type: "image/webp", quality: 0.85, width: 1600, height: 1200 },
      { type: "image/webp", quality: 0.85, width: 400, height: 300 },
    ]);
    expect(close).toHaveBeenCalled();
  });

  it("createImageBitmap に imageOrientation: from-image を渡す（EXIF の向きを反映してから再エンコード）", async () => {
    const { createImageBitmap } = setupCanvas({ bitmap: { width: 100, height: 100 } });
    await convertForUpload(makeFile("a.jpg", "image/jpeg"));
    expect(createImageBitmap).toHaveBeenCalledWith(expect.any(Blob), { imageOrientation: "from-image" });
  });

  it("本画像が 2MB を超えたら品質を 0.7 → 0.55 と下げて再試行する", async () => {
    const bySize: Record<number, number> = {
      0.85: LIMITS.convertedImageMaxBytes + 1,
      0.7: LIMITS.convertedImageMaxBytes + 1,
      0.55: 1024,
    };
    const { calls } = setupCanvas({
      bitmap: { width: 4000, height: 3000 },
      encode: (type, q, width) =>
        new Blob([new Uint8Array(width === 1600 ? (bySize[q] ?? 1024) : 100)], { type }),
    });
    const out = await convertForUpload(makeFile("big.png", "image/png"));
    const fullCalls = calls.filter((c) => c.width === 1600);
    expect(fullCalls.map((c) => c.quality)).toEqual([...QUALITY_STEPS]);
    expect(out.full.size).toBe(1024);
    // サムネイルは 1 回だけ
    expect(calls.filter((c) => c.width === 400)).toHaveLength(1);
  });

  it("品質を下げても 2MB を超えるならエラーにする", async () => {
    setupCanvas({
      bitmap: { width: 4000, height: 3000 },
      encode: (type, _q, width) =>
        new Blob([new Uint8Array(width === 1600 ? LIMITS.convertedImageMaxBytes + 1 : 100)], { type }),
    });
    await expect(convertForUpload(makeFile("big.png", "image/png"))).rejects.toThrow(
      "画像を2MB以内に変換できませんでした",
    );
  });

  it("WebP を出力できないブラウザでは JPEG にフォールバックする", async () => {
    const { calls } = setupCanvas({
      bitmap: { width: 1000, height: 500 },
      // 古い Safari は WebP を頼んでも PNG を返す
      encode: (type) => new Blob([new Uint8Array(10)], { type: type === "image/webp" ? "image/png" : type }),
    });
    const out = await convertForUpload(makeFile("a.jpg", "image/jpeg"));
    expect(out.contentType).toBe("image/jpeg");
    expect(out.full.type).toBe("image/jpeg");
    expect(out.thumb.type).toBe("image/jpeg");
    expect(calls.map((c) => c.type)).toEqual(["image/webp", "image/jpeg", "image/jpeg"]);
  });

  it("HEIC は heic2any で JPEG にしてからデコードする", async () => {
    const jpeg = new Blob([new Uint8Array(50)], { type: "image/jpeg" });
    heicMock.mockResolvedValue(jpeg);
    const { createImageBitmap } = setupCanvas({ bitmap: { width: 300, height: 200 } });
    const out = await convertForUpload(makeFile("IMG_1.HEIC", ""));
    expect(heicMock).toHaveBeenCalledWith(expect.objectContaining({ toType: "image/jpeg" }));
    expect(createImageBitmap.mock.calls[0][0]).toBe(jpeg);
    expect(out.width).toBe(300);
    expect(out.height).toBe(200);
  });

  it("HEIC の変換に失敗したら画面向けの文言で失敗する", async () => {
    heicMock.mockRejectedValue(new Error("boom"));
    setupCanvas({ bitmap: { width: 300, height: 200 } });
    await expect(convertForUpload(makeFile("a.heic", "image/heic"))).rejects.toThrow(
      "HEIC 画像の変換に失敗しました",
    );
  });
});
