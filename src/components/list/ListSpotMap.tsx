"use client";

/**
 * リスト内スポットの地図一括表示（F-4-5）。「地図で見る」トグルで開閉し、全スポットが収まるように寄せる。
 * S-07 と S-10 で共用。ピンをタップするとスポット詳細へ。
 */
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { SpotMapLazy } from "@/components/map";
import type { LatLng, SpotSummary, WishlistItem } from "@/lib/domain/types";
import { Button, cn } from "@/components/ui";
import { spotHref } from "./ListItemRow";

export interface ListSpotMapProps {
  items: WishlistItem[];
  /** 最初から地図を開いておく（共有リストなど） */
  defaultOpen?: boolean;
  className?: string;
}

/** 削除済み（spot が null）を除いたスポット */
export function spotsOfItems(items: WishlistItem[]): SpotSummary[] {
  return items.flatMap((i) => (i.spot ? [i.spot] : []));
}

export function ListSpotMap({ items, defaultOpen = false, className }: ListSpotMapProps) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const spots = useMemo(() => spotsOfItems(items), [items]);
  const fitTo = useMemo<LatLng[] | null>(
    () => (spots.length > 0 ? spots.map((s) => ({ lat: s.lat, lng: s.lng })) : null),
    [spots],
  );
  const onSpotTap = useCallback((spot: SpotSummary) => router.push(spotHref(spot.id)), [router]);

  return (
    <section aria-label="地図" className={cn("flex flex-col gap-3", className)}>
      <div>
        <Button
          variant={open ? "primary" : "secondary"}
          leftIcon="map"
          aria-pressed={open}
          onClick={() => setOpen((v) => !v)}
          disabled={spots.length === 0}
        >
          {open ? "地図を閉じる" : "地図で見る"}
        </Button>
      </div>
      {open && spots.length > 0 ? (
        <div className="h-[320px] overflow-hidden rounded-card border border-border lg:h-[420px]">
          <SpotMapLazy className="h-full w-full" spots={spots} fitTo={fitTo} onSpotTap={onSpotTap} />
        </div>
      ) : null}
      {spots.length === 0 ? (
        <p className="text-base text-text-muted">地図に表示できるスポットがありません。</p>
      ) : null}
    </section>
  );
}
