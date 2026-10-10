import type { ReactNode } from "react";
import { Button } from "./Button";
import { Card } from "./Card";
import { Icon } from "./icons";
import { cn } from "./cn";

export interface ErrorMessageProps {
  message: ReactNode;
  /** 指定すると再試行ボタン（refresh-cw）を出す */
  onRetry?: () => void;
  retryLabel?: string;
  retrying?: boolean;
  className?: string;
}

/** エラー表示：淡い背景＋四辺の枠＋ circle-alert ＋ 文言（8.2） */
export function ErrorMessage({
  message,
  onRetry,
  retryLabel = "再試行",
  retrying = false,
  className,
}: ErrorMessageProps) {
  return (
    <Card tone="danger" role="alert" className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-start gap-2 text-danger">
        <Icon name="circle-alert" size={20} className="mt-0.5" />
        <p className="text-base">{message}</p>
      </div>
      {onRetry ? (
        <div>
          <Button variant="secondary" leftIcon="refresh-cw" onClick={onRetry} loading={retrying}>
            {retryLabel}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
