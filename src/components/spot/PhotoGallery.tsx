"use client";

import { useState } from "react";
import type { Category } from "@/lib/domain/constants";
import { Dialog, IconButton, PhotoImage, cn } from "@/components/ui";

export interface GalleryPhoto {
  id: string;
  thumbUrl: string | null;
  fullUrl: string | null;
}

export interface PhotoGalleryProps {
  photos: GalleryPhoto[];
  spotName: string;
  category: Category;
  className?: string;
}

/** F-3-1：写真ギャラリー。横スクロール、タップで拡大 Dialog（前後へ移動できる） */
export function PhotoGallery({ photos, spotName, category, className }: PhotoGalleryProps) {
  const [index, setIndex] = useState<number | null>(null);
  const current = index === null ? null : photos[index];

  if (photos.length === 0) {
    return (
      <PhotoImage
        src={null}
        alt={`${spotName}の写真はまだありません`}
        category={category}
        className={cn("h-48 w-full", className)}
      />
    );
  }

  return (
    <>
      <ul
        className={cn("flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 py-2", className)}
        aria-label={`${spotName}の写真`}
      >
        {photos.map((p, i) => (
          <li key={p.id} className="shrink-0 snap-start">
            <button
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`${i + 1}枚目の写真を拡大`}
              className="block overflow-hidden rounded-card border border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <PhotoImage
                src={p.thumbUrl ?? p.fullUrl}
                alt={`${spotName}の写真 ${i + 1}枚目`}
                category={category}
                className="h-44 w-44 sm:h-56 sm:w-56"
              />
            </button>
          </li>
        ))}
      </ul>
      <Dialog
        open={current !== null}
        onClose={() => setIndex(null)}
        title={`${spotName}の写真（${(index ?? 0) + 1} / ${photos.length}）`}
        className="max-w-3xl"
      >
        {current ? (
          <div className="flex flex-col gap-3">
            <PhotoImage
              src={current.fullUrl ?? current.thumbUrl}
              alt={`${spotName}の写真 ${(index ?? 0) + 1}枚目`}
              category={category}
              loading="eager"
              className="max-h-[70vh] w-full rounded-card bg-surface-muted object-contain"
            />
            {photos.length > 1 ? (
              <div className="flex items-center justify-between">
                <IconButton
                  icon="chevron-left"
                  iconSize={24}
                  variant="secondary"
                  aria-label="前の写真"
                  disabled={index === 0}
                  onClick={() => setIndex((i) => (i === null ? null : Math.max(0, i - 1)))}
                />
                <IconButton
                  icon="chevron-right"
                  iconSize={24}
                  variant="secondary"
                  aria-label="次の写真"
                  disabled={index === photos.length - 1}
                  onClick={() => setIndex((i) => (i === null ? null : Math.min(photos.length - 1, i + 1)))}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
