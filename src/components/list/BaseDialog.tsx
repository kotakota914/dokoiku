"use client";

/**
 * v0.3 F-4-8：拠点（ホテル・駅など）の設定・変更ダイアログ。
 * 場所の指定は経路作成と同じ PlacePicker（現在地 / スポット名で検索）を再利用する。
 * 保存は親（ListDetail）が PATCH /lists/{listId} { base } で行う。外部 API は場所検索以外に呼ばない。
 */
import { useState } from "react";
import { PlacePicker } from "@/components/plan/PlacePicker";
import { Button, Dialog, ErrorMessage } from "@/components/ui";
import type { PlanPlace } from "@/lib/domain/types";
import { ListIcon } from "./listIcons";

export interface BaseDialogProps {
  open: boolean;
  /** 変更のときは現在の拠点 */
  initial: PlanPlace | null;
  submitting?: boolean;
  serverError?: string | null;
  onSubmit: (place: PlanPlace) => void;
  onClose: () => void;
  onUnauthorized?: () => void;
}

export function BaseDialog({
  open,
  initial,
  submitting = false,
  serverError = null,
  onSubmit,
  onClose,
  onUnauthorized,
}: BaseDialogProps) {
  // Dialog は閉じると unmount されるので、開くたびに initial から始まる
  if (!open) return null;
  return (
    <BaseDialogBody
      initial={initial}
      submitting={submitting}
      serverError={serverError}
      onSubmit={onSubmit}
      onClose={onClose}
      onUnauthorized={onUnauthorized}
    />
  );
}

function BaseDialogBody({
  initial,
  submitting,
  serverError,
  onSubmit,
  onClose,
  onUnauthorized,
}: Omit<BaseDialogProps, "open">) {
  const [place, setPlace] = useState<PlanPlace | null>(initial);
  const changing = initial !== null;
  return (
    <Dialog
      open
      onClose={onClose}
      title={
        <span className="inline-flex items-center gap-2">
          <ListIcon name="house" size={20} />
          {changing ? "拠点を変更" : "拠点を設定"}
        </span>
      }
      description="ホテルや駅など、旅の起点を1つ設定します。各スポットまでの直線距離の表示と、経路作成の出発地の初期値に使います。"
      className="max-w-lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            キャンセル
          </Button>
          <Button
            onClick={() => {
              if (place) onSubmit(place);
            }}
            loading={submitting}
            disabled={!place}
          >
            {changing ? "変更" : "設定"}
          </Button>
        </>
      }
    >
      <PlacePicker
        label="拠点"
        value={place}
        onChange={setPlace}
        disabled={submitting}
        onUnauthorized={onUnauthorized}
      />
      {serverError ? <ErrorMessage message={serverError} /> : null}
    </Dialog>
  );
}
