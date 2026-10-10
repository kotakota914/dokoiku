"use client";

/**
 * 現在地ボタン（F-1-8）。SpotMap の children として置くと useMap() で地図を使える。
 */
import { LoaderCircle, LocateFixed } from "lucide-react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMap, type CurrentLocation } from "./MapContext";
import { geolocationErrorMessage, getCurrentPosition } from "./useGeolocation";

export interface LocateButtonProps {
  /** 省略時は useMap() の地図を使う */
  map?: MapLibreMap | null;
  /** 移動後のズーム（既定 15） */
  zoom?: number;
  /** 取得できたときに呼ばれる（投稿画面などで位置を使うため） */
  onLocate?: (location: CurrentLocation) => void;
  /** 現在地の点を地図に表示するか（既定 true） */
  showMarker?: boolean;
  className?: string;
}

const MESSAGE_MS = 4_000;

export default function LocateButton({
  map: mapProp,
  zoom = 15,
  onLocate,
  showMarker = true,
  className,
}: LocateButtonProps) {
  const ctx = useMap();
  const map = mapProp ?? ctx.map;
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const showMessage = useCallback((text: string) => {
    setMessage(text);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (mountedRef.current) setMessage(null);
    }, MESSAGE_MS);
  }, []);

  const handleClick = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const loc = await getCurrentPosition();
      if (!mountedRef.current) return;
      if (showMarker) ctx.showLocation(loc);
      onLocate?.(loc);
      map?.flyTo({ center: [loc.lng, loc.lat], zoom, duration: 800 });
    } catch (err) {
      if (mountedRef.current) showMessage(geolocationErrorMessage(err));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [showMarker, ctx, onLocate, map, zoom, showMessage]);

  return (
    <div className={`flex flex-col items-end gap-2 ${className ?? ""}`}>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        aria-label="現在地へ移動"
        aria-busy={loading}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[var(--radius-card)] border border-border bg-surface text-text shadow-[var(--shadow-card)] disabled:opacity-60"
      >
        {loading ? (
          <LoaderCircle size={20} strokeWidth={2} className="animate-spin-slow" aria-hidden="true" />
        ) : (
          <LocateFixed size={20} strokeWidth={2} aria-hidden="true" />
        )}
      </button>
      {message ? (
        <p
          role="status"
          className="rounded-[var(--radius-card)] border border-border bg-surface px-3 py-2 text-text-muted"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
