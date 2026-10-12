"use client";

/**
 * 共有ボタン（LINE / X / Instagram など）。外部 API や審査は使わない。
 * - `navigator.share` がある端末（主にスマホ）では OS の共有シートを開く。`imageBlob` があり
 *   `navigator.canShare({ files })` が true なら画像も一緒に渡す（Instagram ストーリーなどを選べる）。
 * - 無い環境（PC）では小さなダイアログで「リンクをコピー」「Xで投稿」「LINEで送る」を出す。
 *   `imageBlob` がある場合は画像をダウンロードする（<a download>）。
 * - 共有 URL はブラウザの origin を基準に絶対 URL にする（serverConfig.siteUrl は使わない）。
 */
import { useState, useSyncExternalStore } from "react";
import { Button, Dialog, IconButton, useToast } from "@/components/ui";
import { absoluteShareUrl, canNativeShare, lineShareUrl, xShareUrl } from "./shareLinks";

export interface ShareButtonProps {
  title: string;
  text: string;
  /** 共有する URL。パス（例：/spots/xxx）なら window.location.origin を付けて絶対 URL にする */
  url: string;
  /** 画像も一緒に共有するときに PNG などの Blob を返す。null を返したら画像なしで続ける */
  imageBlob?: () => Promise<Blob | null>;
  /** 共有・ダウンロードするときのファイル名（既定 share.png） */
  imageFileName?: string;
  /** button：文字付き（既定）／ icon：アイコンだけ（aria-label に label を使う） */
  variant?: "button" | "icon";
  /** ボタンの文言（icon のときは aria-label）。既定「共有」 */
  label?: string;
  className?: string;
}

const noopSubscribe = () => () => undefined;

/** Web Share API が使えるか。SSR と hydration 直後は false（PC 向けの表示）にそろえる */
export function useCanNativeShare(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => canNativeShare(typeof navigator === "undefined" ? undefined : navigator),
    () => false,
  );
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/** <a download> で Blob を保存する */
function downloadBlob(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
}

export interface ShareOptionsProps {
  title: string;
  text: string;
  /** 絶対 URL */
  url: string;
  /** 項目を選んだあと（コピー成功・別タブを開いた）に呼ぶ */
  onDone?: () => void;
  className?: string;
}

/**
 * PC 向けの共有メニュー：リンクをコピー／Xで投稿／LINEで送る。
 * ShareButton のダイアログと、既にダイアログの中にいる画面（リストの共有）で共用する。
 */
export function ShareOptions({ text, url, onDone, className }: ShareOptionsProps) {
  const toast = useToast();

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("リンクをコピーしました");
      onDone?.();
    } catch {
      toast.error("コピーできませんでした。URLを選択してコピーしてください");
    }
  }

  function openExternal(href: string) {
    window.open(href, "_blank", "noopener,noreferrer");
    onDone?.();
  }

  return (
    <div className={className}>
      <div className="flex flex-col gap-2">
        <Button variant="secondary" leftIcon="copy" fullWidth onClick={() => void copy()}>
          リンクをコピー
        </Button>
        <Button
          variant="secondary"
          leftIcon="external-link"
          fullWidth
          onClick={() => openExternal(xShareUrl(text, url))}
        >
          Xで投稿
        </Button>
        <Button
          variant="secondary"
          leftIcon="external-link"
          fullWidth
          onClick={() => openExternal(lineShareUrl(url))}
        >
          LINEで送る
        </Button>
      </div>
      <p className="mt-3 break-all text-base text-text-muted" data-testid="share-url">
        {url}
      </p>
    </div>
  );
}

export function ShareButton({
  title,
  text,
  url,
  imageBlob,
  imageFileName = "share.png",
  variant = "button",
  label = "共有",
  className,
}: ShareButtonProps) {
  const toast = useToast();
  const native = useCanNativeShare();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [absoluteUrl, setAbsoluteUrl] = useState("");

  /** 画像を取得する。失敗したらトーストを出して null */
  async function loadImage(): Promise<Blob | null> {
    if (!imageBlob) return null;
    try {
      const blob = await imageBlob();
      if (!blob) toast.error("画像を取得できませんでした");
      return blob;
    } catch {
      toast.error("画像を取得できませんでした");
      return null;
    }
  }

  async function shareNative(target: string) {
    const data: ShareData = { title, text, url: target };
    if (imageBlob) {
      const blob = await loadImage();
      if (!blob) return;
      const file = new File([blob], imageFileName, { type: blob.type || "image/png" });
      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        data.files = [file];
      } else {
        toast.info("この端末では画像を一緒に共有できないため、リンクだけを共有します");
      }
    }
    try {
      await navigator.share(data);
    } catch (err) {
      if (isAbortError(err)) return;
      toast.error("共有できませんでした");
    }
  }

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    try {
      const target = absoluteShareUrl(url, window.location.origin);
      setAbsoluteUrl(target);
      if (native) {
        await shareNative(target);
        return;
      }
      if (imageBlob) {
        const blob = await loadImage();
        if (!blob) return;
        downloadBlob(blob, imageFileName);
        toast.success("画像を保存しました。Instagram などのアプリから投稿してください");
        return;
      }
      setOpen(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {variant === "icon" ? (
        <IconButton
          icon="share-2"
          aria-label={label}
          loading={busy}
          onClick={() => void handleClick()}
          className={className}
        />
      ) : (
        <Button
          variant="secondary"
          leftIcon="share-2"
          loading={busy}
          onClick={() => void handleClick()}
          className={className}
        >
          {label}
        </Button>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="共有"
        description="共有先を選んでください。LINE や X では、リンクがカード（画像付き）で表示されます。"
      >
        <ShareOptions title={title} text={text} url={absoluteUrl} onDone={() => setOpen(false)} />
      </Dialog>
    </>
  );
}
