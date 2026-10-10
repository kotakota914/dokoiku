"use client";

/**
 * 表示範囲のスポットを GET /spots から取得するフック（F-1-2、F-1-7）。
 * SpotMap の onViewportChange から setViewport を呼ぶ。前回の取得は AbortController で打ち切る。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api/client";
import type { Category } from "@/lib/domain/constants";
import type { HeatPoint, SpotSummary, SpotsInViewResponse } from "@/lib/domain/types";
import { bboxToQuery, type MapBbox } from "@/lib/map/view";

export interface Viewport {
  bbox: MapBbox;
  zoom: number;
}

export interface UseViewportSpotsOptions {
  initialCategories?: Category[];
}

export interface UseViewportSpotsResult {
  /** 直近に取得できたレスポンス。取得中・エラー時も前回の値を保持する */
  data: SpotsInViewResponse | null;
  /** data が spots のときのスポット（それ以外は空配列） */
  spots: SpotSummary[];
  /** data が heatmap のときの点（それ以外は空配列） */
  heatPoints: HeatPoint[];
  loading: boolean;
  /** 画面向けの文言。成功時は null */
  error: string | null;
  /** 同じ条件でもう一度取得する（エラー後の再試行） */
  refetch: () => void;
  /** SpotMap の onViewportChange に渡す */
  setViewport: (bbox: MapBbox, zoom: number) => void;
  viewport: Viewport | null;
  categories: Category[];
  setCategories: (categories: Category[]) => void;
}

const EMPTY_SPOTS: SpotSummary[] = [];
const EMPTY_HEAT: HeatPoint[] = [];

/** GET /spots に送る整数ズーム。mapModeForZoom と同じ丸め（四捨五入）にして表示方式を一致させる */
export function zoomForRequest(zoom: number): number {
  return Math.round(zoom);
}

export function buildSpotsPath(viewport: Viewport, categories: readonly Category[]): string {
  const params = new URLSearchParams({
    bbox: bboxToQuery(viewport.bbox),
    zoom: String(zoomForRequest(viewport.zoom)),
  });
  if (categories.length > 0) params.set("category", categories.join(","));
  return `/spots?${params.toString()}`;
}

function sameViewport(a: Viewport | null, b: Viewport): boolean {
  return (
    a !== null &&
    a.zoom === b.zoom &&
    a.bbox.minLng === b.bbox.minLng &&
    a.bbox.minLat === b.bbox.minLat &&
    a.bbox.maxLng === b.bbox.maxLng &&
    a.bbox.maxLat === b.bbox.maxLat
  );
}

export function useViewportSpots(options: UseViewportSpotsOptions = {}): UseViewportSpotsResult {
  const [viewport, setViewportState] = useState<Viewport | null>(null);
  const [categories, setCategoriesState] = useState<Category[]>(options.initialCategories ?? []);
  const [data, setData] = useState<SpotsInViewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 取得は effect ではなくイベント（表示範囲・絞り込みの変更）から直接始める
  const viewportRef = useRef<Viewport | null>(null);
  const categoriesRef = useRef<Category[]>(categories);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const run = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    api
      .get<SpotsInViewResponse>(buildSpotsPath(vp, categoriesRef.current), { signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted || !mountedRef.current) return;
        setData(res);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || !mountedRef.current) return;
        setError(errorMessage(err, "スポットを取得できませんでした"));
      })
      .finally(() => {
        if (controller.signal.aborted || !mountedRef.current) return;
        setLoading(false);
      });
  }, []);

  const setViewport = useCallback(
    (bbox: MapBbox, zoom: number) => {
      const next = { bbox, zoom };
      if (sameViewport(viewportRef.current, next)) return;
      viewportRef.current = next;
      setViewportState(next);
      run();
    },
    [run],
  );

  const setCategories = useCallback(
    (next: Category[]) => {
      categoriesRef.current = next;
      setCategoriesState(next);
      run();
    },
    [run],
  );

  const spots = data?.mode === "spots" ? data.spots : EMPTY_SPOTS;
  const heatPoints = data?.mode === "heatmap" ? data.points : EMPTY_HEAT;

  return {
    data,
    spots,
    heatPoints,
    loading,
    error,
    refetch: run,
    setViewport,
    viewport,
    categories,
    setCategories,
  };
}
