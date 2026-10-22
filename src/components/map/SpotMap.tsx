"use client";

/**
 * 地図コア（F-1）。MapLibre GL JS ＋ OpenFreeMap ＋ Supercluster。
 * - ズームに応じてヒートマップ（≤8）/ 写真の束（9〜13）/ 写真ピン（≥14）を切り替える（F-1-3）。
 *   切り替えは MAP_MODE_FADE_SEC（0.3 秒）の透明度アニメーション（ヒートマップはレイヤーの heatmap-opacity、
 *   マーカーは Web Animations API）
 * - 移動・ズームの最中も最大 300ms に 1 回、止まったときにすぐ onViewportChange を呼ぶ（F-1-2）
 * - 選んだリストのスポットの強調と拠点のマーカー（F-1-9）
 * - 経路線と番号マーカー（F-5-4）、現在地の点
 * window に依存するコードは useEffect の中だけに置く（SSR 不可。Server Component からは SpotMapLazy を使う）。
 */
import "maplibre-gl/dist/maplibre-gl.css";
import { RefreshCw } from "lucide-react";
import { Map as MapLibreMap, Marker, type GeoJSONSource, type LngLatBoundsLike } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LIMITS, MAP_ZOOM, mapModeForZoom, type MapMode } from "@/lib/domain/constants";
import type { HeatPoint, LatLng, SpotSummary } from "@/lib/domain/types";
import {
  buildClusterIndex,
  clusterBounds,
  clusterExpansionZoom,
  getClusters,
  toClusterView,
  type ClusterView,
} from "@/lib/map/cluster";
import type { RouteStop } from "@/lib/map/route";
import { applyJapaneseLabels, OPENFREEMAP_STYLE_URL, readCssToken } from "@/lib/map/style";
import { throttle } from "@/lib/map/tileCache";
import { bboxContains, expandBbox, getInitialView, type MapBbox, type MapView } from "@/lib/map/view";
import { MapContext, type CurrentLocation, type MapContextValue } from "./MapContext";
import { configureMapLibreWorker } from "./workerUrl";
import {
  createBaseElement,
  createClusterElement,
  createLocationDotElement,
  createPinElement,
  createStopElement,
  disposeMarkerElement,
  fadeInMarker,
  fadeOutMarker,
  modeFadeMs,
  updateBaseElement,
  updateClusterElement,
  updatePinElement,
  updateStopElement,
} from "./markers";

export type RouteGeometry = { type: "LineString"; coordinates: [number, number][] };

/** v0.3 F-1-9：リストの拠点（house のマーカーで表示） */
export interface MapBaseMarker extends LatLng {
  label: string;
}

export interface SpotMapProps {
  /** 写真の束・写真ピンに使うスポット（mode が spots のとき） */
  spots?: SpotSummary[];
  /** ヒートマップの点（mode が heatmap のとき） */
  heatPoints?: HeatPoint[];
  /** 初期位置。省略時は getInitialView(null)（DEFAULT_VIEW）。useHash が true で URL にハッシュがあればそちらを優先 */
  initialView?: MapView;
  /** URL ハッシュ（#zoom/lat/lng）に地図の位置を同期する（トップ画面では true） */
  useHash?: boolean;
  /** マウント直後、移動・ズームの最中（最大 300ms に 1 回）、止まったときに呼ばれる */
  onViewportChange?: (bbox: MapBbox, zoom: number) => void;
  selectedSpotId?: string | null;
  /** v0.3 F-1-9：強調表示するスポット（選んだリストのスポット）の ID */
  highlightSpotIds?: ReadonlySet<string> | null;
  /** v0.3 F-1-9：リストの拠点。null なら表示しない */
  baseMarker?: MapBaseMarker | null;
  /** 写真ピン（または束にならない単独点）をタップしたとき */
  onSpotTap?: (spot: SpotSummary) => void;
  /** 写真の束をタップしたとき。省略時はその範囲にズームインする（F-1-6） */
  onClusterTap?: (bounds: MapBbox, zoomTarget: number) => void;
  /** 経路線（F-5-4） */
  routeGeometry?: RouteGeometry | null;
  /** 経路の番号付きマーカー */
  routeStops?: RouteStop[];
  /** 変わったら fitBounds（padding 48）する。点が1つなら zoom 15 で寄る */
  fitTo?: LatLng[] | MapBbox | null;
  /** false で地図操作を無効化（共有リスト閲覧など）。ピンのタップは可 */
  interactive?: boolean;
  className?: string;
  /** 地図の上に重ねる要素（現在地ボタンなど）。useMap() で地図を使える */
  children?: ReactNode;
  /** 地図が使える状態になったとき（スタイル読み込み完了） */
  onMapReady?: (map: MapLibreMap) => void;
}

const SOURCE_HEAT = "dk-heat";
const LAYER_HEAT = "dk-heat-layer";
const SOURCE_ROUTE = "dk-route";
const LAYER_ROUTE_CASING = "dk-route-casing";
const LAYER_ROUTE_LINE = "dk-route-line";
const SOURCE_LOCATION = "dk-location";
const LAYER_LOCATION_ACCURACY = "dk-location-accuracy";

/** 画面外のマーカーもこの割合だけ先に作っておく（小さな移動で再生成しないため） */
const VIEWPORT_MARGIN = 0.2;
/** ヒートマップを表示しているときの透明度 */
const HEAT_OPACITY = 0.85;
const FIT_PADDING = 48;
const SINGLE_POINT_ZOOM = 15;

type MarkerEntry =
  | { kind: "pin"; marker: Marker; el: HTMLElement; lat: number; lng: number; spot: SpotSummary }
  | { kind: "cluster"; marker: Marker; el: HTMLElement; lat: number; lng: number; view: ClusterView };

/** 表示方式の切り替えで透明にしてから消す途中のマーカー */
interface FadingEntry {
  marker: Marker;
  el: HTMLElement;
}

interface StopEntry {
  marker: Marker;
  el: HTMLElement;
  stop: RouteStop;
}

function boundsToBbox(map: MapLibreMap): MapBbox {
  const b = map.getBounds();
  return { minLng: b.getWest(), minLat: b.getSouth(), maxLng: b.getEast(), maxLat: b.getNorth() };
}

function bboxToBounds(b: MapBbox): LngLatBoundsLike {
  return [
    [b.minLng, b.minLat],
    [b.maxLng, b.maxLat],
  ];
}

function heatCollection(points: readonly HeatPoint[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: points.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      properties: { weight: p.weight },
    })),
  };
}

function routeCollection(geometry: RouteGeometry | null | undefined): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features:
      geometry && geometry.coordinates.length >= 2 ? [{ type: "Feature", geometry, properties: {} }] : [],
  };
}

function locationCollection(loc: CurrentLocation | null): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: loc
      ? [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [loc.lng, loc.lat] },
            properties: { accuracyM: loc.accuracyM },
          },
        ]
      : [],
  };
}

/** 地図タイルの読み込み失敗（F-1 例外）とみなすエラーか */
function isFatalMapError(err: unknown, loaded: boolean): boolean {
  if (!loaded) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /Failed to fetch|NetworkError|Load failed|ERR_INTERNET_DISCONNECTED/i.test(message);
}

const EMPTY_SPOTS: SpotSummary[] = [];
const EMPTY_HEAT: HeatPoint[] = [];
const EMPTY_STOPS: RouteStop[] = [];

export default function SpotMap({
  spots = EMPTY_SPOTS,
  heatPoints = EMPTY_HEAT,
  initialView,
  useHash = false,
  onViewportChange,
  selectedSpotId = null,
  highlightSpotIds = null,
  baseMarker = null,
  onSpotTap,
  onClusterTap,
  routeGeometry = null,
  routeStops = EMPTY_STOPS,
  fitTo = null,
  interactive = true,
  className,
  children,
  onMapReady,
}: SpotMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const loadedRef = useRef(false);
  const markersRef = useRef<Map<string, MarkerEntry>>(new Map());
  const stopMarkersRef = useRef<StopEntry[]>([]);
  const locationMarkerRef = useRef<Marker | null>(null);
  const locationRef = useRef<CurrentLocation | null>(null);
  const fadingRef = useRef<Set<FadingEntry>>(new Set());
  const modeRef = useRef<MapMode | null>(null);
  const baseMarkerRef = useRef<{ marker: Marker; el: HTMLElement } | null>(null);

  const clusterIndex = useMemo(() => buildClusterIndex(spots, highlightSpotIds), [spots, highlightSpotIds]);

  // 最新の props をイベントハンドラから参照するための ref（ハンドラは一度だけ登録する）。
  // 描画のたびに effect で更新する（他の effect より先に宣言しているので先に走る）
  const latest = {
    spots,
    heatPoints,
    selectedSpotId,
    highlightSpotIds,
    onSpotTap,
    onClusterTap,
    onViewportChange,
    onMapReady,
    routeGeometry,
    clusterIndex,
  };
  const propsRef = useRef(latest);
  useEffect(() => {
    propsRef.current = latest;
  });

  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [generation, setGeneration] = useState(0);

  // ---------- マーカーの差分更新 ----------
  const clearMarkers = useCallback(() => {
    for (const entry of markersRef.current.values()) {
      entry.marker.remove();
      disposeMarkerElement(entry.el);
    }
    markersRef.current.clear();
    for (const f of fadingRef.current) {
      f.marker.remove();
      disposeMarkerElement(f.el);
    }
    fadingRef.current.clear();
    modeRef.current = null;
  }, []);

  /** マーカーを消す。表示方式が切り替わったときは透明にしてから消す（F-1-3） */
  const removeMarker = useCallback((marker: Marker, el: HTMLElement, fade: boolean) => {
    if (!fade) {
      marker.remove();
      disposeMarkerElement(el);
      return;
    }
    const entry: FadingEntry = { marker, el };
    fadingRef.current.add(entry);
    fadeOutMarker(el, () => {
      if (!fadingRef.current.delete(entry)) return;
      marker.remove();
      disposeMarkerElement(el);
    });
  }, []);

  const handleMarkerClick = useCallback((key: string) => {
    const map = mapRef.current;
    const entry = markersRef.current.get(key);
    if (!map || !entry) return;
    const { onSpotTap, onClusterTap, spots } = propsRef.current;
    if (entry.kind === "pin") {
      onSpotTap?.(entry.spot);
      return;
    }
    const view = entry.view;
    if (view.clusterId === null) {
      const spot = spots.find((s) => s.id === view.key.slice(2));
      if (spot) onSpotTap?.(spot);
      return;
    }
    const index = propsRef.current.clusterIndex;
    const bounds = clusterBounds(index, view.clusterId);
    const zoomTarget = clusterExpansionZoom(index, view.clusterId);
    if (onClusterTap) {
      onClusterTap(bounds, zoomTarget);
      return;
    }
    // 既定：その範囲にズームイン（F-1-6）。束が分かれるズームまでは必ず寄せる
    const camera = map.cameraForBounds(bboxToBounds(bounds), {
      padding: FIT_PADDING,
      maxZoom: MAP_ZOOM.pinMin,
    });
    const zoom = Math.min(MAP_ZOOM.pinMin, Math.max(camera?.zoom ?? zoomTarget, zoomTarget));
    map.easeTo({ center: [view.lng, view.lat], zoom, duration: 500 });
  }, []);

  const syncMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const { spots, selectedSpotId, highlightSpotIds } = propsRef.current;
    const zoom = map.getZoom();
    const mode = mapModeForZoom(zoom);
    const bbox = expandBbox(boundsToBbox(map), VIEWPORT_MARGIN);
    const prevMode = modeRef.current;
    const modeChanged = prevMode !== null && prevMode !== mode;
    modeRef.current = mode;

    if (map.getLayer(LAYER_HEAT) && (prevMode === null || modeChanged)) {
      // レイヤーは出したまま透明度だけを 0.3 秒で切り替える（heatmap-opacity-transition）
      map.setPaintProperty(LAYER_HEAT, "heatmap-opacity", mode === "heatmap" ? HEAT_OPACITY : 0);
    }

    type Desired = { kind: "pin"; spot: SpotSummary } | { kind: "cluster"; view: ClusterView };
    const desired = new Map<string, Desired>();
    if (mode === "pins") {
      for (const spot of spots) {
        if (bboxContains(bbox, spot)) desired.set(`s:${spot.id}`, { kind: "pin", spot });
      }
    } else if (mode === "cluster") {
      for (const item of getClusters(propsRef.current.clusterIndex, bbox, zoom)) {
        const view = toClusterView(item);
        desired.set(view.key, { kind: "cluster", view });
      }
    }

    const existing = markersRef.current;
    for (const [key, entry] of existing) {
      const want = desired.get(key);
      if (!want || want.kind !== entry.kind) {
        removeMarker(entry.marker, entry.el, modeChanged);
        existing.delete(key);
      }
    }

    for (const [key, want] of desired) {
      const entry = existing.get(key);
      if (want.kind === "pin") {
        const spec = {
          spotId: want.spot.id,
          name: want.spot.name,
          postCount: want.spot.postCount,
          popularity: want.spot.popularity,
          category: want.spot.category,
          coverThumbUrl: want.spot.coverThumbUrl,
          selected: want.spot.id === selectedSpotId,
          highlighted: highlightSpotIds?.has(want.spot.id) ?? false,
        };
        if (entry && entry.kind === "pin") {
          updatePinElement(entry.el, spec);
          if (entry.lat !== want.spot.lat || entry.lng !== want.spot.lng) {
            entry.marker.setLngLat([want.spot.lng, want.spot.lat]);
            entry.lat = want.spot.lat;
            entry.lng = want.spot.lng;
          }
          entry.spot = want.spot;
        } else {
          const el = createPinElement(spec);
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            handleMarkerClick(key);
          });
          const marker = new Marker({ element: el, anchor: "center" })
            .setLngLat([want.spot.lng, want.spot.lat])
            .addTo(map);
          fadeInMarker(el);
          existing.set(key, {
            kind: "pin",
            marker,
            el,
            lat: want.spot.lat,
            lng: want.spot.lng,
            spot: want.spot,
          });
        }
      } else {
        const v = want.view;
        const spec = {
          key: v.key,
          postCount: v.postCount,
          spotCount: v.spotCount,
          coverThumbUrl: v.coverThumbUrl,
          name: v.name,
          category: v.category,
          highlightCount: v.highlightCount,
        };
        if (entry && entry.kind === "cluster") {
          updateClusterElement(entry.el, spec);
          if (entry.lat !== v.lat || entry.lng !== v.lng) {
            entry.marker.setLngLat([v.lng, v.lat]);
            entry.lat = v.lat;
            entry.lng = v.lng;
          }
          entry.view = v;
        } else {
          const el = createClusterElement(spec);
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            handleMarkerClick(key);
          });
          const marker = new Marker({ element: el, anchor: "center" }).setLngLat([v.lng, v.lat]).addTo(map);
          fadeInMarker(el);
          existing.set(key, { kind: "cluster", marker, el, lat: v.lat, lng: v.lng, view: v });
        }
      }
    }
  }, [handleMarkerClick, removeMarker]);

  // ---------- 現在地 ----------
  const showLocation = useCallback((loc: CurrentLocation | null) => {
    locationRef.current = loc;
    const map = mapRef.current;
    if (!map) return;
    if (loc) {
      if (!locationMarkerRef.current) {
        locationMarkerRef.current = new Marker({ element: createLocationDotElement(), anchor: "center" });
      }
      locationMarkerRef.current.setLngLat([loc.lng, loc.lat]).addTo(map);
    } else {
      locationMarkerRef.current?.remove();
    }
    if (loadedRef.current) {
      const src = map.getSource<GeoJSONSource>(SOURCE_LOCATION);
      src?.setData(locationCollection(loc));
    }
  }, []);

  // ---------- 地図の作成・破棄 ----------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const view = initialView ?? getInitialView(null);
    configureMapLibreWorker();
    const map = new MapLibreMap({
      container,
      style: OPENFREEMAP_STYLE_URL,
      center: [view.center.lng, view.center.lat],
      zoom: view.zoom,
      hash: useHash,
      interactive,
      // OpenFreeMap / OpenStreetMap の表記（スタイルの attribution をそのまま表示。狭い画面では自動で折りたたむ）
      attributionControl: {},
      maxZoom: 19,
    });
    mapRef.current = map;
    loadedRef.current = false;
    setMap(map);
    setReady(false);
    setLoadError(false);

    const emitViewport = () => {
      const { onViewportChange } = propsRef.current;
      if (!onViewportChange) return;
      onViewportChange(boundsToBbox(map), map.getZoom());
    };
    // F-1-2：移動中は止まるのを待たず、最大 300ms に 1 回だけ表示範囲を知らせる
    const throttledViewport = throttle(emitViewport, LIMITS.mapFetchDebounceMs);

    const onLoad = () => {
      loadedRef.current = true;
      try {
        applyJapaneseLabels(map);
      } catch {
        // ラベルの置き換えに失敗しても地図は使える
      }
      const primary = readCssToken("--color-primary", "#1c7ed6");
      const primaryStrong = readCssToken("--color-primary-strong", "#1864ab");
      const primarySoft = readCssToken("--color-primary-soft", "#e7f1fb");
      const surface = readCssToken("--color-surface", "#ffffff");

      map.addSource(SOURCE_HEAT, { type: "geojson", data: heatCollection(propsRef.current.heatPoints) });
      map.addLayer({
        id: LAYER_HEAT,
        type: "heatmap",
        source: SOURCE_HEAT,
        maxzoom: MAP_ZOOM.heatmapMax + 1,
        paint: {
          "heatmap-weight": ["interpolate", ["linear"], ["get", "weight"], 0, 0, 1, 0.25, 20, 1],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 0.6, MAP_ZOOM.heatmapMax, 1.4],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 10, MAP_ZOOM.heatmapMax, 28],
          "heatmap-color": [
            "interpolate",
            ["linear"],
            ["heatmap-density"],
            0,
            "rgba(0, 0, 0, 0)",
            0.2,
            primarySoft,
            0.6,
            primary,
            1,
            primaryStrong,
          ],
          "heatmap-opacity": 0,
          // F-1-3：表示方式の切り替えは 0.3 秒かけて透明度を変える
          "heatmap-opacity-transition": { duration: modeFadeMs(), delay: 0 },
        },
      });

      map.addSource(SOURCE_ROUTE, { type: "geojson", data: routeCollection(propsRef.current.routeGeometry) });
      map.addLayer({
        id: LAYER_ROUTE_CASING,
        type: "line",
        source: SOURCE_ROUTE,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": surface, "line-width": 8, "line-opacity": 0.9 },
      });
      map.addLayer({
        id: LAYER_ROUTE_LINE,
        type: "line",
        source: SOURCE_ROUTE,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": primary, "line-width": 4 },
      });

      map.addSource(SOURCE_LOCATION, { type: "geojson", data: locationCollection(locationRef.current) });
      map.addLayer({
        id: LAYER_LOCATION_ACCURACY,
        type: "circle",
        source: SOURCE_LOCATION,
        paint: {
          // 精度（m）を現在のズームでのピクセル半径に換算（赤道基準の概算）
          "circle-radius": [
            "interpolate",
            ["exponential", 2],
            ["zoom"],
            0,
            ["/", ["get", "accuracyM"], 78271.5],
            22,
            ["*", ["/", ["get", "accuracyM"], 78271.5], 4194304],
          ],
          "circle-color": primary,
          "circle-opacity": 0.15,
          "circle-stroke-color": primary,
          "circle-stroke-opacity": 0.4,
          "circle-stroke-width": 1,
        },
      });

      setReady(true);
      propsRef.current.onMapReady?.(map);
      syncMarkers();
      emitViewport();
    };

    const onError = (e: { error?: unknown }) => {
      if (isFatalMapError(e.error, loadedRef.current)) setLoadError(true);
    };
    const onMove = () => {
      throttledViewport();
    };
    const onMoveEnd = () => {
      syncMarkers();
      // 止まったら待たずに知らせる（停止後 1 秒以内に描画する。13 章）
      throttledViewport();
      throttledViewport.flush();
    };

    map.on("load", onLoad);
    map.on("error", onError);
    map.on("move", onMove);
    map.on("moveend", onMoveEnd);

    // 親要素の高さの変化に追従する
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => map.resize()) : null;
    observer?.observe(container);

    return () => {
      observer?.disconnect();
      throttledViewport.cancel();
      map.off("load", onLoad);
      map.off("error", onError);
      map.off("move", onMove);
      map.off("moveend", onMoveEnd);
      clearMarkers();
      if (baseMarkerRef.current) {
        baseMarkerRef.current.marker.remove();
        disposeMarkerElement(baseMarkerRef.current.el);
        baseMarkerRef.current = null;
      }
      for (const s of stopMarkersRef.current) {
        s.marker.remove();
        disposeMarkerElement(s.el);
      }
      stopMarkersRef.current = [];
      locationMarkerRef.current?.remove();
      locationMarkerRef.current = null;
      loadedRef.current = false;
      mapRef.current = null;
      map.remove();
      setMap(null);
      setReady(false);
    };
    // 初期位置・hash・interactive は作成時にだけ使う。generation で再作成（再読み込み）する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation, syncMarkers, clearMarkers]);

  // スポット・選択・強調の変更でマーカーを更新
  useEffect(() => {
    if (!ready) return;
    syncMarkers();
  }, [ready, spots, selectedSpotId, highlightSpotIds, syncMarkers]);

  // リストの拠点（F-1-9）
  const baseLat = baseMarker?.lat;
  const baseLng = baseMarker?.lng;
  const baseLabel = baseMarker?.label;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const current = baseMarkerRef.current;
    if (baseLat === undefined || baseLng === undefined || baseLabel === undefined) {
      if (current) {
        current.marker.remove();
        disposeMarkerElement(current.el);
        baseMarkerRef.current = null;
      }
      return;
    }
    if (current) {
      updateBaseElement(current.el, baseLabel);
      current.marker.setLngLat([baseLng, baseLat]);
      return;
    }
    const el = createBaseElement(baseLabel);
    const marker = new Marker({ element: el, anchor: "bottom" }).setLngLat([baseLng, baseLat]).addTo(map);
    baseMarkerRef.current = { marker, el };
  }, [ready, baseLat, baseLng, baseLabel]);

  // ヒートマップの点
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.getSource<GeoJSONSource>(SOURCE_HEAT)?.setData(heatCollection(heatPoints));
  }, [ready, heatPoints]);

  // 経路線
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.getSource<GeoJSONSource>(SOURCE_ROUTE)?.setData(routeCollection(routeGeometry));
  }, [ready, routeGeometry]);

  // 経路の番号マーカー（順番で再利用）
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const entries = stopMarkersRef.current;
    while (entries.length > routeStops.length) {
      const e = entries.pop()!;
      e.marker.remove();
      disposeMarkerElement(e.el);
    }
    routeStops.forEach((stop, i) => {
      const spec = { label: stop.label, kind: stop.kind, name: stop.name };
      const entry = entries[i];
      if (entry) {
        updateStopElement(entry.el, spec);
        if (entry.stop.lat !== stop.lat || entry.stop.lng !== stop.lng)
          entry.marker.setLngLat([stop.lng, stop.lat]);
        entry.stop = stop;
      } else {
        const el = createStopElement(spec);
        const marker = new Marker({ element: el, anchor: "center" })
          .setLngLat([stop.lng, stop.lat])
          .addTo(map);
        entries.push({ marker, el, stop });
      }
    });
  }, [ready, routeStops]);

  // fitTo：範囲に合わせる
  const fitKey = useMemo(() => (fitTo ? JSON.stringify(fitTo) : ""), [fitTo]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fitKey) return;
    const target = JSON.parse(fitKey) as LatLng[] | MapBbox;
    if (Array.isArray(target)) {
      if (target.length === 0) return;
      if (target.length === 1) {
        map.flyTo({ center: [target[0].lng, target[0].lat], zoom: SINGLE_POINT_ZOOM });
        return;
      }
      let minLng = Infinity;
      let minLat = Infinity;
      let maxLng = -Infinity;
      let maxLat = -Infinity;
      for (const p of target) {
        minLng = Math.min(minLng, p.lng);
        maxLng = Math.max(maxLng, p.lng);
        minLat = Math.min(minLat, p.lat);
        maxLat = Math.max(maxLat, p.lat);
      }
      map.fitBounds(bboxToBounds({ minLng, minLat, maxLng, maxLat }), { padding: FIT_PADDING, maxZoom: 16 });
      return;
    }
    map.fitBounds(bboxToBounds(target), { padding: FIT_PADDING, maxZoom: 16 });
  }, [fitKey, map]);

  const reload = useCallback(() => {
    setLoadError(false);
    setGeneration((g) => g + 1);
  }, []);

  const contextValue = useMemo<MapContextValue>(
    () => ({ map, ready, showLocation }),
    [map, ready, showLocation],
  );

  return (
    <MapContext.Provider value={contextValue}>
      <div className={`relative overflow-hidden bg-surface-muted ${className ?? ""}`} data-testid="spot-map">
        <div ref={containerRef} className="absolute inset-0 h-full w-full" />
        {loadError ? (
          <div
            role="alert"
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-surface/90 p-6 text-center"
          >
            <p className="text-text">地図を読み込めませんでした</p>
            <button
              type="button"
              onClick={reload}
              className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-card)] bg-primary px-4 text-on-primary"
            >
              <RefreshCw size={20} strokeWidth={2} aria-hidden="true" />
              再読み込み
            </button>
          </div>
        ) : null}
        {children}
      </div>
    </MapContext.Provider>
  );
}
