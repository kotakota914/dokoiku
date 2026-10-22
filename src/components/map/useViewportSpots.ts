"use client";

/**
 * 表示範囲のスポットを区画（タイル）単位で取得するフック（F-1-2、F-1-7、ADR-0024）。
 * - GET /spots/tiles/{z}/{x}/{y} を区画ごとに呼び、取得済みの区画はブラウザに保持して再利用する
 * - 表示範囲＋外側 1 画面分を先読み、同時 6 件まで並列、ズーム段階が変わったら古い取得は中断
 * - 新しいデータが届くまで前のピンを残す。取得失敗はエラー表示せず、次の移動時に再取得する
 * ロジックは src/lib/map/tileCache.ts（TileLoader）に切り出して単体テストしている。
 * SpotMap の onViewportChange（移動中は最大 300ms に 1 回）から setViewport を呼ぶ。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api/client";
import type { Category } from "@/lib/domain/constants";
import type { HeatPoint, SpotSummary, SpotsInViewResponse } from "@/lib/domain/types";
import { TileLoader, tileRequestPath, type TileViewState } from "@/lib/map/tileCache";
import { bboxToQuery, type MapBbox } from "@/lib/map/view";

export interface Viewport {
  bbox: MapBbox;
  zoom: number;
}

export interface UseViewportSpotsOptions {
  initialCategories?: Category[];
  /** 同時に取得する区画数（既定 6） */
  maxConcurrent?: number;
}

export interface UseViewportSpotsResult {
  /** 表示範囲の区画を結合した結果。最初の setViewport までは null。取得中も前のピンを保持する */
  data: SpotsInViewResponse | null;
  /** data が spots のときのスポット（それ以外は空配列） */
  spots: SpotSummary[];
  /** data が heatmap のときの点（それ以外は空配列） */
  heatPoints: HeatPoint[];
  /** 取得中・取得待ちの区画があるか */
  loading: boolean;
  /** 表示範囲の区画がすべて取得済みか（「投稿がありません」の判定に使う） */
  complete: boolean;
  /**
   * 画面向けのエラー文言。v0.3 F-1 例外「移動中の取得に失敗：エラー表示はしない」に従い常に null。
   * 互換のため残している
   */
  error: string | null;
  /** 未取得（失敗したものを含む）の区画をもう一度取得する */
  refetch: () => void;
  /** SpotMap の onViewportChange に渡す */
  setViewport: (bbox: MapBbox, zoom: number) => void;
  viewport: Viewport | null;
  categories: Category[];
  setCategories: (categories: Category[]) => void;
}

const EMPTY_SPOTS: SpotSummary[] = [];
const EMPTY_HEAT: HeatPoint[] = [];

/** 旧 GET /spots に送る整数ズーム。mapModeForZoom と同じ丸め（四捨五入） */
export function zoomForRequest(zoom: number): number {
  return Math.round(zoom);
}

/**
 * 旧 GET /spots?bbox= のパス（互換のため残す。検索・リストの地図など bbox 単位で取る画面向け）。
 * トップの地図は区画単位（tileRequestPath）で取得する。
 */
export function buildSpotsPath(viewport: Viewport, categories: readonly Category[]): string {
  const params = new URLSearchParams({
    bbox: bboxToQuery(viewport.bbox),
    zoom: String(zoomForRequest(viewport.zoom)),
  });
  if (categories.length > 0) params.set("category", categories.join(","));
  return `/spots?${params.toString()}`;
}

/** TileLoader の状態を API と同じ形（SpotsInViewResponse）にする */
export function toResponse(state: TileViewState): SpotsInViewResponse {
  return state.mode === "heatmap"
    ? { mode: "heatmap", points: state.heatPoints }
    : { mode: "spots", spots: state.spots };
}

export function useViewportSpots(options: UseViewportSpotsOptions = {}): UseViewportSpotsResult {
  const [viewport, setViewportState] = useState<Viewport | null>(null);
  const [categories, setCategoriesState] = useState<Category[]>(options.initialCategories ?? []);
  const [state, setState] = useState<TileViewState | null>(null);

  const loaderRef = useRef<TileLoader | null>(null);
  const categoriesRef = useRef(categories);
  const viewportRef = useRef<Viewport | null>(null);
  const maxConcurrent = options.maxConcurrent ?? 6;

  // ローダーは effect の中で作り、アンマウントで取得中をすべて中断する
  useEffect(() => {
    const loader = new TileLoader({
      maxConcurrent,
      fetchTile: (tile, cats, signal) =>
        api.get<SpotsInViewResponse>(tileRequestPath(tile, cats), { signal }),
      onChange: setState,
    });
    loader.setCategories(categoriesRef.current);
    const vp = viewportRef.current;
    if (vp) loader.setViewport(vp.bbox, vp.zoom);
    loaderRef.current = loader;
    return () => {
      loader.dispose();
      if (loaderRef.current === loader) loaderRef.current = null;
    };
  }, [maxConcurrent]);

  const setViewport = useCallback((bbox: MapBbox, zoom: number) => {
    const next = { bbox, zoom };
    viewportRef.current = next;
    setViewportState(next);
    loaderRef.current?.setViewport(bbox, zoom);
  }, []);

  const setCategories = useCallback((next: Category[]) => {
    categoriesRef.current = next;
    setCategoriesState(next);
    loaderRef.current?.setCategories(next);
  }, []);

  const refetch = useCallback(() => {
    loaderRef.current?.retry();
  }, []);

  const data = useMemo(() => (state ? toResponse(state) : null), [state]);
  const spots = state?.mode === "spots" ? state.spots : EMPTY_SPOTS;
  const heatPoints = state?.mode === "heatmap" ? state.heatPoints : EMPTY_HEAT;

  return {
    data,
    spots,
    heatPoints,
    loading: state?.loading ?? false,
    complete: state?.complete ?? false,
    error: null,
    refetch,
    setViewport,
    viewport,
    categories,
    setCategories,
  };
}
