"use client";

import { useState } from "react";
import { api, ApiClientError, errorMessage } from "@/lib/api/client";
import { LIMITS, REPORT_REASONS, REPORT_REASON_LABELS, type ReportReason } from "@/lib/domain/constants";
import { createReportSchema } from "@/lib/validation/schemas";
import { Button, ChipGroup, Dialog, FormField, Textarea, useToast } from "@/components/ui";
import { useRequireLogin } from "./useRequireLogin";

export interface ReportDialogProps {
  postId: string;
  open: boolean;
  onClose: () => void;
}

const REASON_OPTIONS = REPORT_REASONS.map((r) => ({ value: r, label: REPORT_REASON_LABELS[r] }));

/** F-7-1：投稿の通報。理由（必須）＋任意メモ（100 文字）→ POST /posts/{postId}/reports */
export function ReportDialog({ postId, open, onClose }: ReportDialogProps) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<{ reason?: string; note?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();
  const requireLogin = useRequireLogin();

  function reset() {
    setReason(null);
    setNote("");
    setErrors({});
  }

  function close() {
    if (submitting) return;
    reset();
    onClose();
  }

  async function submit() {
    const parsed = createReportSchema.safeParse({ reason: reason ?? undefined, note: note || undefined });
    if (!parsed.success) {
      const next: { reason?: string; note?: string } = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === "reason") next.reason = "通報の理由を選んでください";
        else if (key === "note") next.note = issue.message;
      }
      if (!reason) next.reason = "通報の理由を選んでください";
      setErrors(next);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await api.post(`/posts/${postId}/reports`, parsed.data);
      toast.success("通報を受け付けました");
      reset();
      onClose();
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.isUnauthorized) {
          requireLogin();
          return;
        }
        if (err.code === "CONFLICT") {
          toast.info("すでに通報済みです");
          reset();
          onClose();
          return;
        }
      }
      toast.error(errorMessage(err, "通報に失敗しました"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="この投稿を通報"
      description="通報の内容は運営が確認します。通報が一定数に達した投稿は自動で非表示になります。"
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={submitting}>
            キャンセル
          </Button>
          <Button variant="danger" leftIcon="flag" onClick={submit} loading={submitting}>
            通報する
          </Button>
        </>
      }
    >
      <FormField label="理由" required asGroup error={errors.reason}>
        {({ id }) => (
          <ChipGroup
            aria-labelledby={`${id}-label`}
            options={REASON_OPTIONS}
            value={reason}
            onChange={setReason}
            disabled={submitting}
          />
        )}
      </FormField>
      <FormField label="補足（任意）" hint={`${LIMITS.reportNoteMax}文字まで`} error={errors.note}>
        {({ id, describedBy, invalid }) => (
          <Textarea
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            maxLength={LIMITS.reportNoteMax}
            showCount
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="状況を簡単に教えてください"
            disabled={submitting}
          />
        )}
      </FormField>
    </Dialog>
  );
}
