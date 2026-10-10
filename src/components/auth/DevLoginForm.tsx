"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar, Button, Card, ErrorMessage, LoadingState } from "@/components/ui";

export interface DevLoginFormProps {
  next: string;
}

interface DevUser {
  id: string;
  displayName: string;
  isAdmin: boolean;
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

/** S-11（memory モード）：開発用ログイン。seed のユーザーを選ぶだけでログインできる */
export function DevLoginForm({ next }: DevLoginFormProps) {
  const router = useRouter();
  const [users, setUsers] = useState<DevUser[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fetchUsers = useCallback(() => {
    return fetch("/api/dev/users", { headers: { Accept: "application/json" } })
      .then(async (res) => {
        if (!res.ok) throw new Error(await readError(res, "開発用ユーザーを取得できませんでした"));
        return (await res.json()) as { users: DevUser[] };
      })
      .then((body) => {
        setUsers(body.users);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : "開発用ユーザーを取得できませんでした");
      });
  }, []);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  function retry() {
    setLoadError(null);
    setUsers(null);
    void fetchUsers();
  }

  async function login(userId: string) {
    setSubmitting(userId);
    setSubmitError(null);
    try {
      const res = await fetch("/api/dev/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) throw new Error(await readError(res, "ログインに失敗しました"));
      router.push(next);
      router.refresh();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "ログインに失敗しました");
      setSubmitting(null);
    }
  }

  return (
    <Card tone="muted" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-text">開発用ログイン（Supabase 未設定時）</h2>
        <p className="text-base text-text-muted">
          memory モードで動作しています。Google
          ログインの代わりに、初期データのユーザーを選んでログインします。
        </p>
      </div>
      {loadError ? (
        <ErrorMessage message={loadError} onRetry={retry} />
      ) : users === null ? (
        <LoadingState message="ユーザーを読み込んでいます" />
      ) : users.length === 0 ? (
        <p className="text-base text-text-muted">ログインできるユーザーがありません</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {users.map((u) => (
            <li key={u.id}>
              <Button
                variant="secondary"
                fullWidth
                className="justify-start"
                loading={submitting === u.id}
                disabled={submitting !== null && submitting !== u.id}
                onClick={() => login(u.id)}
              >
                <Avatar src={null} name={u.displayName} size={32} />
                <span className="flex-1 text-left">{u.displayName}</span>
                {u.isAdmin ? <span className="text-sm text-text-muted">管理者</span> : null}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {submitError ? <ErrorMessage message={submitError} /> : null}
    </Card>
  );
}
