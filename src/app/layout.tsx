import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell, type AppShellUser } from "@/components/layout/AppShell";
import { SystemStatusProvider } from "@/components/system/SystemStatusProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { getCurrentUser } from "@/lib/auth/server";
import { serverConfig } from "@/lib/config";

const SITE_NAME = "旅行どこいこう";
const SITE_DESCRIPTION = "写真付きの地図でスポットを探し、無理のない回り方を自動で作る旅行計画アプリ";

/** OGP の既定値。各ページの generateMetadata で title / description / url を上書きする */
export const metadata: Metadata = {
  metadataBase: new URL(serverConfig.siteUrl),
  title: { default: SITE_NAME, template: `%s | ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  openGraph: {
    siteName: SITE_NAME,
    type: "website",
    locale: "ja_JP",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1c7ed6",
};

/** ヘッダー表示用のユーザー。Repository が未設定でも画面を止めない */
async function loadShellUser(): Promise<AppShellUser | null> {
  try {
    const user = await getCurrentUser();
    if (!user) return null;
    return {
      displayName: user.profile?.displayName ?? user.suggestedDisplayName,
      avatarUrl: user.profile?.avatarUrl ?? user.suggestedAvatarUrl,
    };
  } catch (err) {
    console.error("[layout] getCurrentUser に失敗しました", err instanceof Error ? err.message : err);
    return null;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await loadShellUser();
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <SystemStatusProvider>
          <ToastProvider>
            <AppShell user={user}>{children}</AppShell>
          </ToastProvider>
        </SystemStatusProvider>
      </body>
    </html>
  );
}
