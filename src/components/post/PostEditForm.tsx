"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSystemStatus } from "@/components/system/SystemStatusProvider";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  ErrorMessage,
  Icon,
  IconButton,
  PageHeader,
  PhotoImage,
  SuspendedNotice,
  useToast,
} from "@/components/ui";
import { loginHref } from "@/components/spot/useRequireLogin";
import { ApiClientError, api, errorMessage } from "@/lib/api/client";
import { LIMITS } from "@/lib/domain/constants";
import type { PostImageView, PostView } from "@/lib/domain/types";
import { uploadImages, type UploadedImage } from "@/lib/images/upload";
import { updatePostSchema, type UpdatePostInput } from "@/lib/validation/schemas";
import { PhotoPicker } from "./PhotoPicker";
import { ContentFields, validateContent } from "./StepContent";
import type { ContentValue, PhotoItem, PhotoUpdater } from "./types";
import { UPLOAD_EXPIRED_MESSAGE, isImageUploadError } from "./uploadError";

export interface PostEditFormProps {
  post: PostView;
}

type SaveState =
  | { phase: "idle" }
  | { phase: "uploading"; done: number; total: number }
  | { phase: "saving" }
  | { phase: "error"; message: string; retryable: boolean }
  | { phase: "suspended" };

/** 残す既存写真。PATCH の images には確定済みの Storage パスをそのまま渡す（posts.ts の updatePost が残す） */
export type KeptImage = Required<Pick<PostImageView, "fullPath" | "thumbPath">> &
  Pick<PostImageView, "id" | "thumbUrl" | "width" | "height" | "sortOrder">;

/** API レスポンスの画像のうち、Storage のパスを持つもの（memory / supabase とも返す）だけ残せる */
export function keepableImages(images: readonly PostImageView[]): KeptImage[] {
  return [...images]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .flatMap((img) =>
      img.fullPath && img.thumbPath
        ? [
            {
              id: img.id,
              thumbUrl: img.thumbUrl,
              width: img.width,
              height: img.height,
              sortOrder: img.sortOrder,
              fullPath: img.fullPath,
              thumbPath: img.thumbPath,
            },
          ]
        : [],
    );
}

/** 残す写真＋新しい写真の合計が 1〜4 枚で、新しい写真の変換が終わっているか */
export function canSavePhotos(kept: readonly KeptImage[], photos: readonly PhotoItem[]): boolean {
  const total = kept.length + photos.length;
  return (
    total >= LIMITS.postImagesMin &&
    total <= LIMITS.postImagesMax &&
    photos.every((p) => p.status === "ready" && p.converted)
  );
}

/**
 * S-05 投稿編集（F-2-12）。コメント・カテゴリ・滞在時間の変更と、写真の追加・削除。
 * - 既存の写真は API レスポンスの fullPath / thumbPath を「残す写真」として保持し、1 枚ずつ削除できる
 * - 空きがあれば PhotoPicker で追加し、保存時は images = [残す写真（確定済みパス）, 新しい写真（tmp パス）] を PATCH に渡す
 * - 写真を変えていなければ PATCH の images を省略する（画像は変更しない）
 * - 投稿（アップロード）が停止中（Q4）でも、写真を追加しない編集と削除はできる
 */
export function PostEditForm({ post }: PostEditFormProps) {
  const router = useRouter();
  const toast = useToast();
  const { loading: statusLoading, isSuspended } = useSystemStatus();
  const postSuspended = !statusLoading && isSuspended("post_create");

  const [content, setContent] = useState<ContentValue>({
    comment: post.comment,
    category: post.category,
    stayDuration: post.stayDuration,
  });
  const [initialKept] = useState<KeptImage[]>(() => keepableImages(post.images));
  const [kept, setKept] = useState<KeptImage[]>(initialKept);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [save, setSave] = useState<SaveState>({ phase: "idle" });
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const uploadedRef = useRef<{ key: string; images: UploadedImage[] } | null>(null);
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  useEffect(() => {
    return () => {
      for (const p of photosRef.current) if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
    };
  }, []);

  const updatePhotos = useCallback((updater: PhotoUpdater) => setPhotos((prev) => updater(prev)), []);

  const goToLogin = useCallback(() => {
    router.push(loginHref(`/posts/${encodeURIComponent(post.id)}/edit`));
  }, [router, post.id]);

  const photosChanged = photos.length > 0 || kept.length !== initialKept.length;
  const contentValid = validateContent(content).ok;
  const photosValid = !photosChanged || canSavePhotos(kept, photos);
  const saving = save.phase === "uploading" || save.phase === "saving";
  // 停止中は写真のアップロードだけできない（F-2-12 ＋ Q4）。写真を追加しない保存・削除はできる
  const uploadSuspended = postSuspended || save.phase === "suspended";
  const uploadBlocked = uploadSuspended && photos.length > 0;
  const remainingSlots = Math.max(0, LIMITS.postImagesMax - kept.length);

  function removeKept(id: string) {
    setKept((prev) => prev.filter((img) => img.id !== id));
  }

  function resetPhotos() {
    for (const p of photos) if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
    setPhotos([]);
    setKept(initialKept);
    uploadedRef.current = null;
  }

  async function doSave() {
    const validated = validateContent(content);
    if (!validated.ok || !photosValid || uploadBlocked) return;
    try {
      let images: UpdatePostInput["images"];
      if (photosChanged) {
        let uploaded: UploadedImage[] = [];
        if (photos.length > 0) {
          const key = photos.map((p) => p.id).join(",");
          const cached = uploadedRef.current?.key === key ? uploadedRef.current.images : null;
          if (cached) uploaded = cached;
          else {
            const converted = photos.map((p) => p.converted!);
            setSave({ phase: "uploading", done: 0, total: converted.length * 2 });
            uploaded = await uploadImages(converted, (done, total) =>
              setSave({ phase: "uploading", done, total }),
            );
            uploadedRef.current = { key, images: uploaded };
          }
        }
        images = [
          ...kept.map((img) => ({
            fullPath: img.fullPath,
            thumbPath: img.thumbPath,
            width: img.width,
            height: img.height,
          })),
          ...uploaded,
        ];
      }
      setSave({ phase: "saving" });
      const body: UpdatePostInput = {
        comment: validated.data.comment,
        category: validated.data.category,
        stayDuration: validated.data.stayDuration,
        ...(images ? { images } : {}),
      };
      const parsed = updatePostSchema.safeParse(body);
      if (!parsed.success) {
        setSave({
          phase: "error",
          message: parsed.error.issues[0]?.message ?? "入力内容を確認してください",
          retryable: false,
        });
        return;
      }
      await api.patch<PostView>(`/posts/${encodeURIComponent(post.id)}`, parsed.data);
      toast.success("投稿を更新しました");
      router.push("/me");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.isUnauthorized) {
          goToLogin();
          return;
        }
        if (err.isSuspended) {
          setSave({ phase: "suspended" });
          return;
        }
        if (err.code === "NOT_FOUND" || isImageUploadError(err)) {
          // 一時アップロードが期限切れ・不正なら tmp パスを捨て、再試行で再アップロードする
          uploadedRef.current = null;
          setSave({
            phase: "error",
            message: isImageUploadError(err) ? UPLOAD_EXPIRED_MESSAGE : err.message,
            retryable: true,
          });
          return;
        }
        if (err.code === "VALIDATION_ERROR" || err.code === "FORBIDDEN") {
          setSave({ phase: "error", message: err.message, retryable: false });
          return;
        }
      }
      setSave({ phase: "error", message: errorMessage(err, "保存に失敗しました"), retryable: true });
    }
  }

  async function doDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.delete(`/posts/${encodeURIComponent(post.id)}`);
      toast.success("投稿を削除しました");
      setDeleteOpen(false);
      router.push("/me");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError && err.isUnauthorized) {
        goToLogin();
        return;
      }
      setDeleteError(errorMessage(err, "削除に失敗しました"));
      setDeleteOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  const progressLabel =
    save.phase === "uploading"
      ? `写真をアップロード中 ${save.done}/${save.total}`
      : save.phase === "saving"
        ? "保存しています"
        : null;

  const totalPhotos = kept.length + photos.length;

  return (
    <div className="flex flex-1 flex-col bg-background">
      <PageHeader
        title="投稿を編集"
        backHref="/me"
        actions={
          <Button
            variant="ghost"
            leftIcon="trash-2"
            className="text-danger"
            onClick={() => setDeleteOpen(true)}
            disabled={saving}
          >
            削除
          </Button>
        }
      />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-4">
        <Card as="section" aria-labelledby="edit-spot" className="flex flex-col gap-2">
          <h2 id="edit-spot" className="text-base font-semibold text-text">
            スポット
          </h2>
          <p className="flex items-start gap-2 text-base text-text">
            <Icon name="map-pin" size={20} className="mt-0.5 text-primary-strong" />
            <span className="font-medium">{post.spotName}</span>
          </p>
          <p className="flex items-start gap-1 text-base text-text-muted">
            <Icon name="info" size={16} className="mt-1" />
            <span>
              スポットは変更できません。別のスポットに付け直す場合は、この投稿を削除して再投稿してください。
            </span>
          </p>
        </Card>

        <Card as="section" aria-labelledby="edit-photos" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="edit-photos" className="text-base font-semibold text-text">
              写真
            </h2>
            <span className="text-base text-text-muted">
              {totalPhotos}/{LIMITS.postImagesMax}枚
            </span>
            {photosChanged ? (
              <Badge icon="pencil" tone="primary">
                写真を変更中
              </Badge>
            ) : null}
          </div>

          {kept.length > 0 ? (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="現在の写真">
              {kept.map((img, i) => (
                <li key={img.id} className="flex flex-col gap-1">
                  <div className="aspect-square overflow-hidden rounded-card border border-border">
                    <PhotoImage
                      src={img.thumbUrl}
                      alt={`現在の写真 ${i + 1}枚目`}
                      category={post.category}
                      className="size-full"
                    />
                  </div>
                  <IconButton
                    icon="trash-2"
                    aria-label={`現在の写真 ${i + 1}枚目を削除`}
                    variant="danger"
                    disabled={saving}
                    onClick={() => removeKept(img.id)}
                    className="self-center"
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-start gap-1 text-base text-text-muted">
              <Icon name="info" size={16} className="mt-1" />
              <span>現在の写真はありません。写真を{LIMITS.postImagesMin}枚以上残すか追加してください。</span>
            </p>
          )}

          {uploadSuspended ? (
            <SuspendedNotice
              feature="post_create"
              detail="無料枠の上限に近づいたため、写真の追加はできません。写真を追加しない編集と削除はできます。"
            />
          ) : null}

          {remainingSlots > 0 || photos.length > 0 ? (
            <PhotoPicker
              photos={photos}
              onChange={updatePhotos}
              max={remainingSlots}
              disabled={saving || uploadSuspended}
            />
          ) : (
            <p className="text-base text-text-muted">
              写真は{LIMITS.postImagesMax}枚までです。追加するには現在の写真を削除してください。
            </p>
          )}

          {photosChanged ? (
            <Button
              variant="ghost"
              leftIcon="x"
              onClick={resetPhotos}
              disabled={saving}
              className="self-start"
            >
              写真の変更を元に戻す
            </Button>
          ) : null}
        </Card>

        <Card as="section" aria-labelledby="edit-content" className="flex flex-col gap-3">
          <h2 id="edit-content" className="text-base font-semibold text-text">
            内容
          </h2>
          <ContentFields value={content} onChange={setContent} showCategoryError disabled={saving} />
        </Card>

        {save.phase === "error" ? (
          <ErrorMessage message={save.message} onRetry={save.retryable ? () => void doSave() : undefined} />
        ) : null}
        {deleteError ? (
          <ErrorMessage
            message={deleteError}
            onRetry={() => setDeleteOpen(true)}
            retryLabel="もう一度削除する"
          />
        ) : null}

        <div className="flex gap-2">
          <Button
            leftIcon="check"
            className="flex-1"
            onClick={() => void doSave()}
            disabled={uploadBlocked || !contentValid || !photosValid}
            loading={saving}
          >
            {saving && progressLabel ? progressLabel : "保存"}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        title="この投稿を削除しますか"
        description="写真とコメントは元に戻せません。スポットの投稿数や代表写真も更新されます。"
        confirmLabel="削除する"
        danger
        loading={deleting}
        onConfirm={() => void doDelete()}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}
