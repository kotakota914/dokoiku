"use client";

import type { ReactNode } from "react";
import { Badge, Card, CategoryLabel, Icon, StayDurationLabel } from "@/components/ui";
import { WizardFooter } from "./WizardFooter";
import type { ContentValue, LocationChoice, PhotoItem } from "./types";

export interface StepConfirmProps {
  photos: PhotoItem[];
  location: LocationChoice;
  content: ContentValue;
  onBack: () => void;
  onSubmit: () => void;
  submitting: boolean;
  /** 送信中の進捗文言（「写真をアップロード中 2/8」など） */
  progressLabel?: string | null;
  /** 停止中などで送信できないとき */
  disabled?: boolean;
  /** エラー・停止中・重複候補などの表示 */
  notice?: ReactNode;
}

/** ステップ 4：確認（F-2-2）。写真・場所・内容を見せて「投稿する」 */
export function StepConfirm({
  photos,
  location,
  content,
  onBack,
  onSubmit,
  submitting,
  progressLabel,
  disabled = false,
  notice,
}: StepConfirmProps) {
  return (
    <div className="flex flex-col gap-4">
      <Card as="section" aria-labelledby="confirm-photos" className="flex flex-col gap-3">
        <h2 id="confirm-photos" className="text-base font-semibold text-text">
          写真（{photos.length}枚）
        </h2>
        <ul className="grid grid-cols-4 gap-2" aria-label="投稿する写真">
          {photos.map((p, i) => (
            <li
              key={p.id}
              className="aspect-square overflow-hidden rounded-card border border-border bg-surface-muted"
            >
              {p.previewUrl ? (
                <img
                  src={p.previewUrl}
                  alt={`${i + 1}枚目：${p.fileName}`}
                  className="size-full object-cover"
                />
              ) : null}
            </li>
          ))}
        </ul>
      </Card>

      <Card as="section" aria-labelledby="confirm-location" className="flex flex-col gap-2">
        <h2 id="confirm-location" className="text-base font-semibold text-text">
          場所
        </h2>
        <p className="flex items-start gap-2 text-base text-text">
          <Icon name="map-pin" size={20} className="mt-0.5 text-primary-strong" />
          <span className="break-words font-medium">
            {location.newSpot ? location.newSpot.name : location.spotName}
          </span>
        </p>
        {location.newSpot ? (
          <div className="flex flex-col gap-1">
            <Badge icon="plus" tone="primary" className="self-start">
              新しいスポットとして登録
            </Badge>
            {location.newSpot.address ? (
              <p className="text-base text-text-muted">{location.newSpot.address}</p>
            ) : null}
          </div>
        ) : null}
      </Card>

      <Card as="section" aria-labelledby="confirm-content" className="flex flex-col gap-3">
        <h2 id="confirm-content" className="text-base font-semibold text-text">
          内容
        </h2>
        <dl className="flex flex-col gap-2 text-base">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <dt className="text-text-muted">カテゴリ</dt>
            <dd className="text-text">
              {content.category ? <CategoryLabel category={content.category} /> : "未選択"}
            </dd>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <dt className="text-text-muted">滞在時間</dt>
            <dd className="text-text">
              <StayDurationLabel duration={content.stayDuration} emptyLabel="未設定" />
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-text-muted">コメント</dt>
            <dd className="whitespace-pre-wrap break-words text-text">
              {content.comment.trim() ? content.comment : <span className="text-text-muted">（なし）</span>}
            </dd>
          </div>
        </dl>
      </Card>

      <WizardFooter
        onBack={onBack}
        onNext={onSubmit}
        nextLabel={submitting && progressLabel ? progressLabel : "投稿する"}
        nextIcon="camera"
        nextDisabled={disabled}
        nextLoading={submitting}
      >
        {notice}
      </WizardFooter>
    </div>
  );
}
