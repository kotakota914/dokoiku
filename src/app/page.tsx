import type { Metadata } from "next";
import { MapHome } from "@/components/home/MapHome";

export const metadata: Metadata = {
  title: "マップ",
};

/**
 * S-01 マップ（トップ）。ログイン不要。
 * AppShell の main は内容の高さで伸びるので、地図の高さが 0 にならないよう明示する
 * （スマホ：画面から下部ナビ（はみ出し分を含む）を引いた高さ、PC：画面からヘッダーを引いた高さ）。
 */
export default function HomePage() {
  return (
    <div className="flex h-[calc(100dvh-var(--bottom-nav-clearance)-env(safe-area-inset-bottom))] min-h-0 flex-col lg:h-[calc(100dvh-var(--header-height))]">
      <MapHome />
    </div>
  );
}
