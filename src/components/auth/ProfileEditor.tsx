"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Avatar, Button, Dialog, ErrorMessage, FormField, Input, useToast } from "@/components/ui";
import { api, errorMessage } from "@/lib/api/client";
import { LIMITS } from "@/lib/domain/constants";
import type { Profile } from "@/lib/domain/types";
import { updateProfileSchema } from "@/lib/validation/schemas";

export interface ProfileEditorProps {
  profile: Profile;
}

/** S-13：表示名・アイコン URL の変更（PATCH /api/v1/me）。F-6-3 */
export function ProfileEditor({ profile }: ProfileEditorProps) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl ?? "");
  const [fieldErrors, setFieldErrors] = useState<{ displayName?: string; avatarUrl?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function openDialog() {
    setDisplayName(profile.displayName);
    setAvatarUrl(profile.avatarUrl ?? "");
    setFieldErrors({});
    setError(null);
    setOpen(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const input = {
      displayName: displayName.trim(),
      avatarUrl: avatarUrl.trim() === "" ? null : avatarUrl.trim(),
    };
    const parsed = updateProfileSchema.safeParse(input);
    if (!parsed.success) {
      const errs: { displayName?: string; avatarUrl?: string } = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === "displayName" && !errs.displayName) errs.displayName = issue.message;
        if (key === "avatarUrl" && !errs.avatarUrl)
          errs.avatarUrl = "アイコンは https:// から始まる URL を入力してください";
      }
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});
    setError(null);
    setSaving(true);
    try {
      await api.patch<Profile>("/me", parsed.data);
      toast.success("プロフィールを更新しました");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err, "プロフィールを更新できませんでした"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button variant="secondary" leftIcon="pencil" onClick={openDialog}>
        プロフィールを編集
      </Button>
      <Dialog
        open={open}
        onClose={() => (saving ? undefined : setOpen(false))}
        title="プロフィールを編集"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>
              キャンセル
            </Button>
            <Button type="submit" form="profile-editor-form" leftIcon="check" loading={saving}>
              保存する
            </Button>
          </>
        }
      >
        <form id="profile-editor-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <div className="flex items-center gap-3">
            <Avatar src={avatarUrl || null} name={displayName || profile.displayName} size={64} />
            <p className="text-base text-text-muted">
              アイコンは画像の URL を指定します。空にすると既定のアイコンになります。
            </p>
          </div>
          <FormField
            label="表示名"
            required
            hint={`${LIMITS.displayNameMin}〜${LIMITS.displayNameMax}文字`}
            error={fieldErrors.displayName}
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
          <FormField label="アイコン画像の URL" error={fieldErrors.avatarUrl}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                name="avatarUrl"
                type="url"
                inputMode="url"
                placeholder="https://"
                value={avatarUrl}
                maxLength={500}
                aria-describedby={describedBy}
                invalid={invalid}
                onChange={(e) => setAvatarUrl(e.target.value)}
              />
            )}
          </FormField>
          {error ? <ErrorMessage message={error} /> : null}
        </form>
      </Dialog>
    </>
  );
}
