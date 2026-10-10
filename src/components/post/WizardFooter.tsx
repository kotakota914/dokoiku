"use client";

import type { ReactNode } from "react";
import { Button, type IconName } from "@/components/ui";

export interface WizardFooterProps {
  /** 無ければ戻るボタンを出さない（最初のステップ） */
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextIcon?: IconName;
  nextDisabled?: boolean;
  nextLoading?: boolean;
  /** ボタンの上に出す補足（エラーなど） */
  children?: ReactNode;
}

/** 各ステップ下部の「戻る／次へ」 */
export function WizardFooter({
  onBack,
  onNext,
  nextLabel = "次へ",
  nextIcon = "chevron-right",
  nextDisabled = false,
  nextLoading = false,
  children,
}: WizardFooterProps) {
  return (
    <div className="flex flex-col gap-3 border-t border-border bg-surface pt-4">
      {children}
      <div className="flex gap-2">
        {onBack ? (
          <Button variant="secondary" leftIcon="chevron-left" onClick={onBack} disabled={nextLoading}>
            戻る
          </Button>
        ) : null}
        <Button
          leftIcon={nextIcon}
          onClick={onNext}
          disabled={nextDisabled}
          loading={nextLoading}
          className="flex-1"
        >
          {nextLabel}
        </Button>
      </div>
    </div>
  );
}
