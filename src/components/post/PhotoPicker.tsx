"use client";

import { useId, useRef, useState, type ChangeEvent } from "react";
import { Card, Icon, IconButton, Spinner, cn } from "@/components/ui";
import { LIMITS } from "@/lib/domain/constants";
import { convertForUpload } from "@/lib/images/convert";
import { validateImageFile } from "@/lib/validation/schemas";
import type { PhotoItem, PhotoUpdater } from "./types";

export interface PhotoPickerProps {
  photos: PhotoItem[];
  /** 変換は非同期なので、更新は関数で受ける（アンマウント後の完了にも対応） */
  onChange: (updater: PhotoUpdater) => void;
  max?: number;
  disabled?: boolean;
}

let seq = 0;
function nextId(): string {
  seq += 1;
  return `photo-${Date.now().toString(36)}-${seq}`;
}

export const ACCEPT_ATTR = "image/*,.heic,.heif";

/**
 * 写真の選択・変換・プレビュー・削除・並び替え（F-2-3、F-2-4）。
 * 選択時に validateImageFile でチェックし、ブラウザで WebP に変換してからプレビューを出す。
 */
export function PhotoPicker({
  photos,
  onChange,
  max = LIMITS.postImagesMax,
  disabled = false,
}: PhotoPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const errorId = useId();
  const remaining = Math.max(0, max - photos.length);
  const full = remaining === 0;

  function removePhoto(id: string) {
    onChange((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }

  function move(id: string, delta: -1 | 1) {
    onChange((prev) => {
      const index = prev.findIndex((p) => p.id === id);
      const to = index + delta;
      if (index < 0 || to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });
  }

  async function handleFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    // 同じファイルをもう一度選べるようにリセットする
    e.target.value = "";
    if (files.length === 0) return;

    const messages: string[] = [];
    const accepted: File[] = [];
    for (const file of files) {
      const problem = validateImageFile(file);
      if (problem) messages.push(`${file.name}：${problem}`);
      else accepted.push(file);
    }
    if (accepted.length > remaining) {
      messages.push(`写真は${max}枚までです（${accepted.length - remaining}枚は追加されませんでした）`);
    }
    const toAdd = accepted.slice(0, remaining);
    setErrors(messages);

    const placeholders: PhotoItem[] = toAdd.map((file) => ({
      id: nextId(),
      fileName: file.name,
      status: "converting",
    }));
    onChange((prev) => [...prev, ...placeholders]);

    await Promise.all(
      toAdd.map(async (file, i) => {
        const id = placeholders[i].id;
        try {
          const converted = await convertForUpload(file);
          const previewUrl = URL.createObjectURL(converted.thumb);
          onChange((prev) =>
            prev.map((p) => (p.id === id ? { ...p, status: "ready", converted, previewUrl } : p)),
          );
        } catch (err) {
          const message = err instanceof Error && err.message ? err.message : "画像の変換に失敗しました";
          setErrors((prev) => [...prev, `${file.name}：${message}`]);
          onChange((prev) => prev.filter((p) => p.id !== id));
        }
      }),
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled || full}
        onChange={handleFiles}
      />

      {photos.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="選択した写真">
          {photos.map((photo, index) => (
            <li key={photo.id} className="flex flex-col gap-1">
              <div className="relative aspect-square overflow-hidden rounded-card border border-border bg-surface-muted">
                {photo.status === "ready" && photo.previewUrl ? (
                  <img
                    src={photo.previewUrl}
                    alt={`${index + 1}枚目：${photo.fileName}`}
                    className="size-full object-cover"
                  />
                ) : (
                  <div
                    className="flex size-full flex-col items-center justify-center gap-2 text-text-muted"
                    role="status"
                    aria-label={`${photo.fileName} を変換中`}
                  >
                    <Spinner label="変換中" />
                    <span className="text-base">変換中</span>
                  </div>
                )}
                <span className="absolute left-2 top-2 rounded-full border border-border bg-surface px-2 py-0.5 text-base font-medium text-text">
                  {index + 1}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <IconButton
                  icon="chevron-left"
                  aria-label={`${index + 1}枚目を前へ移動`}
                  variant="secondary"
                  disabled={disabled || index === 0}
                  onClick={() => move(photo.id, -1)}
                />
                <IconButton
                  icon="trash-2"
                  aria-label={`${index + 1}枚目を削除`}
                  variant="danger"
                  disabled={disabled}
                  onClick={() => removePhoto(photo.id)}
                />
                <IconButton
                  icon="chevron-right"
                  aria-label={`${index + 1}枚目を後ろへ移動`}
                  variant="secondary"
                  disabled={disabled || index === photos.length - 1}
                  onClick={() => move(photo.id, 1)}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <button
        type="button"
        disabled={disabled || full}
        aria-describedby={errors.length ? errorId : undefined}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-card border border-dashed border-border-strong bg-surface p-4 text-base text-text transition-colors",
          "hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <Icon name="image-plus" size={24} className="text-primary" />
        <span className="font-medium">{full ? `写真は${max}枚までです` : "写真を追加"}</span>
        <span className="text-text-muted">{`あと${remaining}枚 / JPEG・PNG・HEIC・WebP、1枚10MBまで`}</span>
      </button>

      {errors.length > 0 ? (
        <Card tone="danger" role="alert" id={errorId} className="flex items-start gap-2">
          <Icon name="circle-alert" size={20} className="mt-0.5 text-danger" />
          <ul className="flex flex-col gap-1 text-base text-danger">
            {errors.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
