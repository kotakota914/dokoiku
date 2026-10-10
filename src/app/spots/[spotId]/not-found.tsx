import type { Metadata } from "next";
import { ButtonLink, EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "スポットが見つかりません" };

/** S-15 / F-3 例外：存在しない・非表示のスポット */
export default function SpotNotFound() {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <EmptyState
        icon="map-pin"
        title="このスポットは見つかりませんでした"
        description="削除されたか、URL が間違っている可能性があります。"
        action={
          <ButtonLink href="/" leftIcon="map">
            地図に戻る
          </ButtonLink>
        }
      />
    </div>
  );
}
