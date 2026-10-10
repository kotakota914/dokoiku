"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Avatar, Button, ErrorMessage, FormField, Input } from "@/components/ui";
import { api, errorMessage } from "@/lib/api/client";
import { LIMITS } from "@/lib/domain/constants";
import type { Profile } from "@/lib/domain/types";
import { displayNameSchema } from "@/lib/validation/schemas";

export interface WelcomeFormProps {
  initialDisplayName: string;
  avatarUrl: string | null;
  /** 既にプロフィールがある（表示名の変更だけ）なら true */
  hasProfile: boolean;
  next: string;
}

/** S-12：表示名の確認。POST /api/v1/me/profile → next へ */
export function WelcomeForm({ initialDisplayName, avatarUrl, hasProfile, next }: WelcomeFormProps) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = displayNameSchema.safeParse(displayName);
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "表示名を確認してください");
      return;
    }
    setFieldError(null);
    setError(null);
    setSubmitting(true);
    try {
      await api.post<Profile>("/me/profile", { displayName: parsed.data });
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err, "表示名を保存できませんでした"));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <div className="flex items-center gap-3">
        <Avatar src={avatarUrl} name={displayName || "ユーザー"} size={64} />
        <p className="text-base text-text-muted">
          {hasProfile
            ? "表示名を変更できます。"
            : "アプリ内で表示される名前を確認してください。あとからマイページで変更できます。"}
        </p>
      </div>
      <FormField
        label="表示名"
        required
        hint={`${LIMITS.displayNameMin}〜${LIMITS.displayNameMax}文字`}
        error={fieldError}
      >
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            name="displayName"
            value={displayName}
            maxLength={LIMITS.displayNameMax}
            autoComplete="nickname"
            aria-describedby={describedBy}
            invalid={invalid}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        )}
      </FormField>
      {error ? <ErrorMessage message={error} /> : null}
      <Button type="submit" size="lg" fullWidth leftIcon="check" loading={submitting}>
        {hasProfile ? "保存する" : "はじめる"}
      </Button>
    </form>
  );
}
