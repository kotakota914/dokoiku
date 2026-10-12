"use client";

import { useId, useState, type FormEvent } from "react";
import { LIMITS } from "@/lib/domain/constants";
import { listNameSchema } from "@/lib/validation/schemas";
import { Button, Dialog, FormField, Input } from "@/components/ui";

export interface ListNameFormProps {
  /** 初期値（名前変更のとき） */
  initialName?: string;
  submitLabel: string;
  submitting?: boolean;
  /** サーバー側のエラー文言（20 リスト上限など） */
  serverError?: string | null;
  onSubmit: (name: string) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}

/** リスト名（1〜30 文字、listNameSchema）の入力フォーム。作成・名前変更・ListPicker 内の作成で共用 */
export function ListNameForm({
  initialName = "",
  submitLabel,
  submitting = false,
  serverError = null,
  onSubmit,
  onCancel,
  autoFocus = true,
}: ListNameFormProps) {
  const id = useId();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = listNameSchema.safeParse(name);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "リスト名を入力してください");
      return;
    }
    setError(null);
    onSubmit(parsed.data);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <FormField
        label="リスト名"
        htmlFor={`${id}-name`}
        hint={`${LIMITS.listNameMin}〜${LIMITS.listNameMax}文字`}
        error={error ?? serverError}
        required
      >
        {({ id: inputId, describedBy, invalid }) => (
          <Input
            id={inputId}
            name="name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
            maxLength={LIMITS.listNameMax}
            placeholder="例：金沢 秋の旅行"
            aria-describedby={describedBy}
            invalid={invalid}
            autoFocus={autoFocus}
            autoComplete="off"
            disabled={submitting}
          />
        )}
      </FormField>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel ? (
          <Button variant="secondary" onClick={onCancel} disabled={submitting}>
            キャンセル
          </Button>
        ) : null}
        <Button type="submit" loading={submitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

export interface ListNameDialogProps {
  open: boolean;
  title: string;
  initialName?: string;
  submitLabel: string;
  submitting?: boolean;
  serverError?: string | null;
  onSubmit: (name: string) => void;
  onClose: () => void;
}

/** 作成・名前変更のダイアログ */
export function ListNameDialog({
  open,
  title,
  initialName,
  submitLabel,
  submitting = false,
  serverError,
  onSubmit,
  onClose,
}: ListNameDialogProps) {
  return (
    <Dialog open={open} onClose={submitting ? () => undefined : onClose} title={title}>
      {open ? (
        <ListNameForm
          key={initialName ?? ""}
          initialName={initialName}
          submitLabel={submitLabel}
          submitting={submitting}
          serverError={serverError}
          onSubmit={onSubmit}
          onCancel={onClose}
        />
      ) : null}
    </Dialog>
  );
}
