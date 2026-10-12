"use client";

/**
 * 共有ダイアログ（F-4-6）。未共有なら「共有URLを発行」、共有中なら URL の表示・コピー・「共有を停止」。
 * URL はブラウザの origin + /shared/{token} で組み立てる。
 * 共有中は LINE / X などへの共有（スマホは共有シート、PC はリンクのコピー・X・LINE）も出す。
 */
import { useState } from "react";
import { api } from "@/lib/api/client";
import { Button, Dialog, Icon, Input, useToast } from "@/components/ui";
import { ShareButton, ShareOptions, useCanNativeShare } from "@/components/share/ShareButton";
import { listShareText } from "@/components/share/shareLinks";
import { buildShareUrl, shareTokenOf, type ShareResponse } from "./shareUrl";
import { useListApiError } from "./useListApiError";

export interface ShareDialogProps {
  open: boolean;
  listId: string;
  shareToken: string | null;
  /** 共有文言に使うリスト名と件数（無ければ URL だけを共有する） */
  listName?: string;
  itemCount?: number;
  onClose: () => void;
  onChange: (shareToken: string | null) => void;
}

export function ShareDialog({
  open,
  listId,
  shareToken,
  listName,
  itemCount,
  onClose,
  onChange,
}: ShareDialogProps) {
  const toast = useToast();
  const handleError = useListApiError();
  const nativeShare = useCanNativeShare();
  const [busy, setBusy] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const url = shareToken ? buildShareUrl(origin, shareToken) : null;
  const shareTitle = listName ?? "行きたい場所リスト";
  const shareText = listName !== undefined ? listShareText(listName, itemCount ?? 0) : "行きたい場所リスト | 旅行どこいこう";

  async function issue() {
    setBusy(true);
    try {
      const res = await api.post<ShareResponse>(`/lists/${encodeURIComponent(listId)}/share`);
      const token = shareTokenOf(res);
      if (!token) throw new Error("共有URLを取得できませんでした");
      onChange(token);
      toast.success("共有URLを発行しました");
    } catch (err) {
      handleError(err, "共有URLを発行できませんでした");
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    try {
      await api.delete(`/lists/${encodeURIComponent(listId)}/share`);
      onChange(null);
      toast.success("共有を停止しました");
    } catch (err) {
      handleError(err, "共有を停止できませんでした");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("共有URLをコピーしました");
    } catch {
      toast.error("コピーできませんでした。URLを長押しまたは選択してコピーしてください");
    }
  }

  return (
    <Dialog
      open={open}
      onClose={busy ? () => undefined : onClose}
      title="リストを共有"
      description={
        url
          ? "このURLを知っている人は、ログインなしでリストを閲覧できます（編集はできません）。"
          : "共有URLを発行すると、ログインなしでリストを閲覧できるようになります。"
      }
      footer={
        url ? (
          <>
            <Button variant="secondary" leftIcon="x" onClick={() => void stop()} loading={busy}>
              共有を停止
            </Button>
            <Button leftIcon="share-2" onClick={() => void copy()} disabled={busy}>
              URLをコピー
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              閉じる
            </Button>
            <Button leftIcon="share-2" onClick={() => void issue()} loading={busy}>
              共有URLを発行
            </Button>
          </>
        )
      }
    >
      {url ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={`share-url-${listId}`} className="text-base font-medium text-text">
            共有URL
          </label>
          <Input id={`share-url-${listId}`} value={url} readOnly onFocus={(e) => e.currentTarget.select()} />
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1 text-base text-primary hover:underline"
          >
            <Icon name="external-link" size={16} />
            共有ページを開く
          </a>
          {/* LINE / X などへ：スマホは共有シート、PC はダイアログ内に選択肢を並べる（ダイアログの入れ子を避ける） */}
          {nativeShare ? (
            <ShareButton label="LINE や X で共有" title={shareTitle} text={shareText} url={url} className="mt-1" />
          ) : (
            <ShareOptions title={shareTitle} text={shareText} url={url} className="mt-1" />
          )}
        </div>
      ) : null}
    </Dialog>
  );
}
