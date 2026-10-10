import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { WelcomeForm } from "@/components/auth/WelcomeForm";
import { Card, PageHeader } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/server";
import { loginUrl, safeNext } from "@/lib/auth/next-path";

export const metadata: Metadata = { title: "プロフィール設定" };

/** S-12：初回プロフィール設定（F-6-2）。ログイン必須 */
export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const user = await getCurrentUser();
  if (!user) redirect(loginUrl(next === "/" ? "/welcome" : `/welcome?next=${encodeURIComponent(next)}`));

  const hasProfile = user.profile !== null;
  return (
    <>
      <PageHeader title={hasProfile ? "表示名の変更" : "ようこそ"} backHref={hasProfile ? "/me" : "/"} />
      <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-6">
        <Card>
          <WelcomeForm
            initialDisplayName={user.profile?.displayName ?? user.suggestedDisplayName}
            avatarUrl={user.profile?.avatarUrl ?? user.suggestedAvatarUrl}
            hasProfile={hasProfile}
            next={next}
          />
        </Card>
      </div>
    </>
  );
}
