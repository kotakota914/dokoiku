"use client";

import { useState } from "react";
import { useSystemStatus } from "@/components/system/SystemStatusProvider";
import { Button, ButtonLink, SuspendedNotice } from "@/components/ui";
import { ListPicker } from "@/components/list/ListPicker";
import { useRequireLogin } from "./useRequireLogin";

export interface SpotActionsProps {
  spotId: string;
  /**
   * @deprecated v0.3 F-3-5 で外部の地図アプリへのリンクを削除したため使わない。
   * 呼び出し側（src/app/spots/[spotId]/page.tsx）の互換のため受け取るだけ
   */
  lat?: number;
  /** @deprecated lat と同じ */
  lng?: number;
  /** null なら未ログイン */
  currentUserId: string | null;
  className?: string;
}

/**
 * S-02 のボタン列：行きたい場所リストに追加（F-3-4）、このスポットに投稿。
 * v0.3 F-3-5：外部の地図アプリ（Google マップなど）へのリンクは置かない（計画中は外部へ移動させない。ADR-0016）。
 * SNS 共有はページ上部の ShareButton に残す。投稿は無料枠停止中（F-8-5）なら無効化して案内を出す。
 */
export function SpotActions({ spotId, currentUserId, className }: SpotActionsProps) {
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
