import type { Metadata } from "next";
import { MapHome } from "@/components/home/MapHome";
import { getCurrentUser } from "@/lib/auth/server";

export const metadata: Metadata = {
  title: "マップ",
};

/**
 * S-01 マップ（トップ）。ログイン不要。
 * ログイン中（表示名の設定まで完了）だけ「リスト表示の切替」（F-1-9）を出すため、ここでユーザーを確認する。
 * AppShell の main は内容の高さで伸びるので、地図の高さが 0 にならないよう明示する
 * （スマホ：画面から下部ナビ（はみ出し分を含む）を引いた高さ、PC：画面からヘッダーを引いた高さ）。
 */
/** 表示名が未設定（/welcome 前）だと GET /lists が 403 になるため、プロフィールまであるときだけ true */
async function isSignedIn(): Promise<boolean> {
  try {
    const user = await getCurrentUser();
    return Boolean(user?.profile);
  } catch {
    return false;
  }
}

export default async function HomePage() {
  const signedIn = await isSignedIn();
  return (
    <div className="flex h-[calc(100dvh-var(--bottom-nav-clearance)-env(safe-area-inset-bottom))] min-h-0 flex-col lg:h-[calc(100dvh-var(--header-height))]">
      <MapHome signedIn={signedIn} />
    </div>
  );
}
