"use client";

/**
 * navigator.geolocation.getCurrentPosition を Promise で包む（F-1-8、F-2 の現在地取得にも使える）。
 * 取得した現在地は保存しない（6章）。
 */
import { useCallback, useState } from "react";
import type { CurrentLocation } from "./MapContext";

export type GeolocationErrorKind = "unsupported" | "denied" | "unavailable" | "timeout";

export class GeolocationFailure extends Error {
  readonly kind: GeolocationErrorKind;
  constructor(kind: GeolocationErrorKind, message: string) {
    super(message);
    this.name = "GeolocationFailure";
    this.kind = kind;
  }
}

export const GEOLOCATION_MESSAGES: Record<GeolocationErrorKind, string> = {
  unsupported: "この端末では位置情報を利用できません",
  denied: "位置情報の利用が許可されていません",
  unavailable: "現在地を取得できませんでした",
  timeout: "現在地の取得に時間がかかりすぎました",
};

export const GEOLOCATION_TIMEOUT_MS = 8_000;

export interface GetCurrentPositionOptions {
  timeoutMs?: number;
  enableHighAccuracy?: boolean;
  /** キャッシュ済みの位置を許容する時間（ms） */
  maximumAgeMs?: number;
}

/** 現在地を1回取得する。失敗時は GeolocationFailure を reject する */
export function getCurrentPosition(options: GetCurrentPositionOptions = {}): Promise<CurrentLocation> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new GeolocationFailure("unsupported", GEOLOCATION_MESSAGES.unsupported));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy });
      },
      (err) => {
        const kind: GeolocationErrorKind =
          err.code === err.PERMISSION_DENIED
            ? "denied"
            : err.code === err.TIMEOUT
              ? "timeout"
              : "unavailable";
        reject(new GeolocationFailure(kind, GEOLOCATION_MESSAGES[kind]));
      },
      {
        enableHighAccuracy: options.enableHighAccuracy ?? true,
        timeout: options.timeoutMs ?? GEOLOCATION_TIMEOUT_MS,
        maximumAge: options.maximumAgeMs ?? 0,
      },
    );
  });
}

/** エラーを画面向けの文言にする */
export function geolocationErrorMessage(err: unknown): string {
  if (err instanceof GeolocationFailure) return err.message;
  return GEOLOCATION_MESSAGES.unavailable;
}

export interface UseGeolocationResult {
  position: CurrentLocation | null;
  loading: boolean;
  /** 画面向けの文言。成功・未取得なら null */
  error: string | null;
  /** 取得を開始する。成功すれば位置を返し、失敗すれば null を返す（error に文言を入れる） */
  locate: (options?: GetCurrentPositionOptions) => Promise<CurrentLocation | null>;
  clear: () => void;
}

/** 現在地の取得状態を持つフック */
export function useGeolocation(): UseGeolocationResult {
  const [position, setPosition] = useState<CurrentLocation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locate = useCallback(async (options?: GetCurrentPositionOptions) => {
    setLoading(true);
    setError(null);
    try {
      const pos = await getCurrentPosition(options);
      setPosition(pos);
      return pos;
    } catch (err) {
      setError(geolocationErrorMessage(err));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    setPosition(null);
    setError(null);
  }, []);

  return { position, loading, error, locate, clear };
}
