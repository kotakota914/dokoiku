import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

export const metadata: Metadata = { title: "ページが見つかりません" };

/** S-15：見つかりません */
export default function NotFound() {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <EmptyState
        icon="triangle-alert"
        title="ページが見つかりません"
        description="URL が間違っているか、削除された可能性があります。"
        action={
          <ButtonLink href="/" leftIcon="map">
            トップへ戻る
          </ButtonLink>
        }
      />
    </div>
  );
}
