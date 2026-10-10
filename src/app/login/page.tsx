import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AgreementNotice } from "@/components/auth/AgreementNotice";
import { DevLoginForm } from "@/components/auth/DevLoginForm";
import { GoogleLoginButton } from "@/components/auth/GoogleLoginButton";
import { Card, ErrorMessage, Icon, PageHeader } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/server";
import { safeNext, welcomeUrl } from "@/lib/auth/next-path";
import { getDataBackend } from "@/lib/config";

export const metadata: Metadata = { title: "ログイン" };

const ERROR_MESSAGES: Record<string, string> = {
  oauth: "Google ログインに失敗しました。もう一度お試しください",
};

/** S-11：ログイン。supabase モードは Google、memory モードは開発用ログイン */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const next = safeNext(sp.next);

  let user = null;
  try {
    user = await getCurrentUser();
  } catch (err) {
    console.error("[login] getCurrentUser に失敗しました", err instanceof Error ? err.message : err);
  }
  if (user) redirect(user.profile ? next : welcomeUrl(next));

  const backend = getDataBackend();
  const errorMessage = sp.error ? (ERROR_MESSAGES[sp.error] ?? "ログインに失敗しました") : null;

  return (
    <>
      <PageHeader title="ログイン" backHref="/" />
      <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-6">
        <Card className="flex flex-col gap-5">
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-primary-soft text-primary-strong">
              <Icon name="log-in" size={24} />
            </span>
            <h2 className="text-lg font-semibold text-text">旅行どこいこう にログイン</h2>
            <p className="text-base text-text-muted">
              投稿、行きたい場所リスト、経路作成にはログインが必要です。地図やスポットの閲覧はログインなしでも使えます。
            </p>
          </div>
          {errorMessage ? <ErrorMessage message={errorMessage} /> : null}
          {backend === "supabase" ? <GoogleLoginButton next={next} /> : <DevLoginForm next={next} />}
          <AgreementNotice />
        </Card>
      </div>
    </>
  );
}
