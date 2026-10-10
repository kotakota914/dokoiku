"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/lib/api/client";
import type { Feature } from "@/lib/domain/constants";
import type { SuspendedFeature, SystemStatus } from "@/lib/domain/types";

/** 取得に失敗したときの保守的な既定値（外部サービスは使えないものとして扱う） */
export const DEFAULT_SYSTEM_STATUS: SystemStatus = {
  suspended: [],
  capabilities: { externalSearch: false, routing: false, googleLogin: false, backend: "memory" },
};

/** 再取得の間隔（5 分） */
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export interface SystemStatusContextValue {
  status: SystemStatus;
  /** 初回取得が終わるまで true */
  loading: boolean;
  /** 直近の取得に失敗したら true（status は既定値または前回の値） */
  error: boolean;
  isSuspended: (feature: Feature) => boolean;
  suspendedInfo: (feature: Feature) => SuspendedFeature | null;
  refresh: () => Promise<void>;
}

const SystemStatusContext = createContext<SystemStatusContextValue | null>(null);

export interface SystemStatusProviderProps {
  children: ReactNode;
  /** テストや SSR で初期値を与えたいとき */
  initialStatus?: SystemStatus;
}

/** F-8-5：起動時に GET /system/status を取得し、停止中の機能を画面へ共有する。失敗しても画面は止めない */
export function SystemStatusProvider({ children, initialStatus }: SystemStatusProviderProps) {
  const [status, setStatus] = useState<SystemStatus>(initialStatus ?? DEFAULT_SYSTEM_STATUS);
  const [loading, setLoading] = useState(initialStatus === undefined);
  const [error, setError] = useState(false);
  const inFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    if (inFlight.current) return inFlight.current;
    const p = api
      .get<SystemStatus>("/system/status")
      .then((s) => {
        setStatus(s);
        setError(false);
      })
      .catch(() => {
        setError(true);
      })
      .finally(() => {
        setLoading(false);
        inFlight.current = null;
      });
    inFlight.current = p;
    return p;
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const value = useMemo<SystemStatusContextValue>(
    () => ({
      status,
      loading,
      error,
      isSuspended: (feature) => status.suspended.some((s) => s.feature === feature),
      suspendedInfo: (feature) => status.suspended.find((s) => s.feature === feature) ?? null,
      refresh,
    }),
    [status, loading, error, refresh],
  );

  return <SystemStatusContext.Provider value={value}>{children}</SystemStatusContext.Provider>;
}

export function useSystemStatus(): SystemStatusContextValue {
  const ctx = useContext(SystemStatusContext);
  if (!ctx) throw new Error("useSystemStatus は SystemStatusProvider の内側で使ってください");
  return ctx;
}
