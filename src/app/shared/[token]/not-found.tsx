import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

export const metadata: Metadata = { title: "このリストは共有されていません" };

/** F-4 例外：停止済み・存在しない共有 URL */
export default function SharedNotFound() {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <EmptyState
        icon="share-2"
        title="このリストは共有されていません"
        description="共有が停止されたか、URL が間違っている可能性があります。"
        action={
          <ButtonLink href="/" leftIcon="map">
            トップへ戻る
          </ButtonLink>
        }
      />
    </div>
  );
}
