"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmDialog, ErrorMessage, useToast } from "@/components/ui";
import { api, errorMessage } from "@/lib/api/client";

/** S-13：ログアウト（form POST /auth/signout）と退会（DELETE /api/v1/me）。F-6-3、F-6-4 */
export function AccountActions() {
  const router = useRouter();
  const toast = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteAccount() {
    setDeleting(true);
    setError(null);
    try {
      // DELETE /me はサーバー側でセッションも破棄する
      await api.delete<void>("/me");
      setConfirmOpen(false);
      toast.success("退会しました。ご利用ありがとうございました");
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err, "退会処理に失敗しました"));
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <form method="post" action="/auth/signout">
        <Button type="submit" variant="secondary" fullWidth leftIcon="log-out">
          ログアウト
        </Button>
      </form>
      <Button
        variant="ghost"
        fullWidth
        leftIcon="trash-2"
        className="text-danger"
        onClick={() => setConfirmOpen(true)}
      >
        退会する
      </Button>
      {error ? <ErrorMessage message={error} /> : null}
      <ConfirmDialog
        open={confirmOpen}
        danger
        title="退会しますか？"
        description="投稿・リスト・経路プラン・写真をすべて削除します。この操作は取り消せません。"
        confirmLabel="退会する"
        loading={deleting}
        onConfirm={deleteAccount}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
