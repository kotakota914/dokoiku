"use client";

/**
 * MapLibre GL JS v6 はワーカーを別ファイル（maplibre-gl-worker.mjs）として読み込む。
 * 既定では `import.meta.url`（バンドル後のチャンク URL）の隣から探すため、Next.js のビルドでは
 * 404 になり「Worker failed to load」でタイルを描画できない。
 * ワーカーファイルを静的アセットとして取り込み、その URL を MapLibre に渡す。
 */
import { getWorkerUrl, setWorkerUrl } from "maplibre-gl";

let configured = false;

export function configureMapLibreWorker(): void {
  if (configured || typeof window === "undefined") return;
  configured = true;
  if (getWorkerUrl()) return;
  try {
    const url = new URL("../../../node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url);
    setWorkerUrl(url.href);
  } catch (err) {
    console.error("[map] ワーカー URL を設定できませんでした", err instanceof Error ? err.message : err);
  }
}
