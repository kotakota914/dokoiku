"use client";

import { useState } from "react";
import { Button, ErrorMessage } from "@/components/ui";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export interface GoogleLoginButtonProps {
  /** ログイン後の戻り先（同一オリジンのパス。サーバー側で検証済み） */
  next: string;
}

/** S-11：Google ログインの開始（signInWithOAuth はブラウザから直接呼ぶ唯一の supabase-js 利用） */
export function GoogleLoginButton({ next }: GoogleLoginButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setError("Google ログインは設定されていません（NEXT_PUBLIC_SUPABASE_URL を確認してください）");
      return;
    }
    setLoading(true);
    setError(null);
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (err) {
      setError("Google ログインを開始できませんでした。しばらくしてからもう一度お試しください");
      setLoading(false);
    }
    // 成功時は Google へ遷移するので loading のままにする
  }

  return (
    <div className="flex flex-col gap-3">
      <Button size="lg" fullWidth leftIcon="log-in" loading={loading} onClick={start}>
        Googleでログイン
      </Button>
      {error ? <ErrorMessage message={error} /> : null}
    </div>
  );
}
