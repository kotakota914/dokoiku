"use client";

import { LIMITS } from "@/lib/domain/constants";
import { PhotoPicker } from "./PhotoPicker";
import { WizardFooter } from "./WizardFooter";
import type { PhotoItem, PhotoUpdater } from "./types";

export interface StepPhotosProps {
  photos: PhotoItem[];
  onChange: (updater: PhotoUpdater) => void;
  onNext: () => void;
}

/** 次へ進める条件：1〜4 枚がすべて変換済み */
export function canProceedPhotos(photos: PhotoItem[]): boolean {
  return (
    photos.length >= LIMITS.postImagesMin &&
    photos.length <= LIMITS.postImagesMax &&
    photos.every((p) => p.status === "ready" && p.converted)
  );
}

/** ステップ 1：写真選択（F-2-3、F-2-4） */
export function StepPhotos({ photos, onChange, onNext }: StepPhotosProps) {
  const converting = photos.some((p) => p.status === "converting");
  return (
    <div className="flex flex-col gap-4">
      <p className="text-base text-text-muted">
        写真を{LIMITS.postImagesMin}〜{LIMITS.postImagesMax}
        枚選んでください。1枚目が代表写真になります。写真は端末上で縮小し、位置情報などの付加情報を取り除いてから送信します。
      </p>
      <PhotoPicker photos={photos} onChange={onChange} />
      <WizardFooter onNext={onNext} nextDisabled={!canProceedPhotos(photos)} nextLoading={converting} />
    </div>
  );
}
