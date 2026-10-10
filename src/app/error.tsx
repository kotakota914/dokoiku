"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/icons";

interface ErrorPageProps {
  error: Error & { digest?: string };
  /** Next.js 16：再取得して再描画する */
  retry?: () => void;
  reset?: () => void;
}

/** S-15：エラー */
export default function ErrorPage({ error, retry, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const onRetry = retry ?? reset;

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Card
        tone="danger"
        role="alert"
        className="flex w-full max-w-md flex-col items-center gap-4 p-6 text-center"
      >
        <span className="flex size-14 items-center justify-center rounded-full bg-surface text-danger">
          <Icon name="circle-alert" size={24} />
        </span>
        <h1 className="text-lg font-semibold text-text">エラーが発生しました</h1>
        <p className="text-base text-text-muted">
          時間をおいて再試行してください。繰り返し発生する場合は開発者にお知らせください。
        </p>
        {error.digest ? <p className="text-base text-text-faint">識別子：{error.digest}</p> : null}
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
          {onRetry ? (
            <Button leftIcon="refresh-cw" onClick={() => onRetry()}>
              再試行
            </Button>
          ) : null}
          <ButtonLink href="/" variant="secondary" leftIcon="map">
            トップへ戻る
          </ButtonLink>
        </div>
      </Card>
    </div>
  );
}
