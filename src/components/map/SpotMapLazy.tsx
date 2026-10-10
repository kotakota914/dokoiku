"use client";

/**
 * SpotMap を next/dynamic（ssr: false）で読み込む薄いラッパー。
 * Server Component や通常のページからはこちらを使う（maplibre-gl は SSR 不可）。
 */
import dynamic from "next/dynamic";
import { LoaderCircle } from "lucide-react";
import type { SpotMapProps } from "./SpotMap";

export function MapSkeleton({ className }: { className?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex animate-pulse items-center justify-center bg-surface-muted text-text-muted ${className ?? ""}`}
    >
      <span className="inline-flex items-center gap-2">
        <LoaderCircle size={20} strokeWidth={2} className="animate-spin-slow" aria-hidden="true" />
        地図を読み込んでいます
      </span>
    </div>
  );
}

const SpotMapDynamic = dynamic(() => import("./SpotMap"), {
  ssr: false,
  loading: () => <MapSkeleton className="h-full w-full" />,
});

export default function SpotMapLazy(props: SpotMapProps) {
  return <SpotMapDynamic {...props} />;
}
