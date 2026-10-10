import type { ReactNode } from "react";
import { FEATURE_LABELS, type Feature } from "@/lib/domain/constants";
import { Card } from "./Card";
import { Icon } from "./icons";
import { cn } from "./cn";

export interface SuspendedNoticeProps {
  feature: Feature;
  /** 補足（代替手段の案内など） */
  detail?: ReactNode;
  className?: string;
}

/** 機能停止中の案内（F-8-5）。circle-pause ＋「現在、〜は利用できません」 */
export function SuspendedNotice({ feature, detail, className }: SuspendedNoticeProps) {
  return (
    <Card tone="warning" role="status" className={cn("flex items-start gap-2", className)}>
      <Icon name="circle-pause" size={20} className="mt-0.5 text-warning" />
      <div className="flex flex-col gap-1">
        <p className="text-base font-medium text-text">現在、{FEATURE_LABELS[feature]}は利用できません</p>
        {detail ? <p className="text-base text-text-muted">{detail}</p> : null}
      </div>
    </Card>
  );
}
