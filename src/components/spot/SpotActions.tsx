"use client";

import { useState } from "react";
import { googleMapsPlaceUrl } from "@/lib/utils/geo";
import { useSystemStatus } from "@/components/system/SystemStatusProvider";
import { Button, ButtonLink, Icon, SuspendedNotice, buttonClassName } from "@/components/ui";
import { ListPicker } from "@/components/list/ListPicker";
import { useRequireLogin } from "./useRequireLogin";

export interface SpotActionsProps {
  spotId: string;
  lat: number;
  lng: number;
  /** null なら未ログイン */
  currentUserId: string | null;
  className?: string;
}

/**
 * S-02 のボタン列：行きたい場所リストに追加（F-3-4）、Googleマップで開く（F-3-5）、このスポットに投稿。
 * 投稿は無料枠停止中（F-8-5）なら無効化して案内を出す。
 */
export function SpotActions({ spotId, lat, lng, currentUserId, className }: SpotActionsProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const requireLogin = useRequireLogin();
  const { loading, isSuspended } = useSystemStatus();
  const postSuspended = !loading && isSuspended("post_create");

  function openPicker() {
    if (!currentUserId) {
      requireLogin();
      return;
    }
    setPickerOpen(true);
  }

  return (
    <div className={className}>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button leftIcon="bookmark-plus" onClick={openPicker} className="sm:flex-1">
          行きたい場所リストに追加
        </Button>
        <a
          href={googleMapsPlaceUrl({ lat, lng })}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClassName({ variant: "secondary" }, "sm:flex-1")}
        >
          <Icon name="external-link" size={20} />
          Googleマップで開く
        </a>
        {postSuspended ? (
          <Button variant="secondary" leftIcon="camera" disabled className="sm:flex-1">
            このスポットに投稿
          </Button>
        ) : (
          <ButtonLink
            href={`/posts/new?spotId=${encodeURIComponent(spotId)}`}
            variant="secondary"
            leftIcon="camera"
            className="sm:flex-1"
          >
            このスポットに投稿
          </ButtonLink>
        )}
      </div>
      {postSuspended ? (
        <SuspendedNotice
          feature="post_create"
          className="mt-3"
          detail="閲覧とリストへの追加は引き続き使えます。"
        />
      ) : null}
      {currentUserId ? (
        <ListPicker spotId={spotId} open={pickerOpen} onClose={() => setPickerOpen(false)} />
      ) : null}
    </div>
  );
}
