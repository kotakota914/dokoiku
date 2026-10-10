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
  PageHeader,
  PhotoImage,
  SuspendedNotice,
  useToast,
} from "@/components/ui";
import { loginHref } from "@/components/spot/useRequireLogin";
import { ApiClientError, api, errorMessage } from "@/lib/api/client";
import { LIMITS } from "@/lib/domain/constants";
import type { PostView } from "@/lib/domain/types";
import { uploadImages, type UploadedImage } from "@/lib/images/upload";
import { updatePostSchema, type UpdatePostInput } from "@/lib/validation/schemas";
import { PhotoPicker } from "./PhotoPicker";
import { ContentFields, validateContent } from "./StepContent";
import { canProceedPhotos } from "./StepPhotos";
import type { ContentValue, PhotoItem, PhotoUpdater } from "./types";

export interface PostEditFormProps {
  post: PostView;
}

type SaveState =
  | { phase: "idle" }
  | { phase: "uploading"; done: number; total: number }
  | { phase: "saving" }
  | { phase: "error"; message: string; retryable: boolean }
  | { phase: "suspended" };

/**
 * S-05 投稿編集（F-2-12）。コメント・カテゴリ・滞在時間の変更と、写真の差し替え・削除。
 * 既存の画像は API レスポンスに Storage のパスが無いため、「写真を変更する」を押したときだけ
 * 新しい写真一式で置き換える（PATCH の images を省略すれば画像は変更しない）。
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
  const [replacePhotos, setReplacePhotos] = useState(false);
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

  const existingImages = [...post.images].sort((a, b) => a.sortOrder - b.sortOrder);
  const contentValid = validateContent(content).ok;
  const photosValid = !replacePhotos || canProceedPhotos(photos);
  const saving = save.phase === "uploading" || save.phase === "saving";
  const blocked = postSuspended || save.phase === "suspended";

  function cancelReplace() {
    for (const p of photos) if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
    setPhotos([]);
    uploadedRef.current = null;
    setReplacePhotos(false);
  }

  async function doSave() {
    const validated = validateContent(content);
    if (!validated.ok || !photosValid) return;
    try {
      let images: UploadedImage[] | undefined;
      if (replacePhotos) {
        const key = photos.map((p) => p.id).join(",");
        images = uploadedRef.current?.key === key ? uploadedRef.current.images : undefined;
        if (!images) {
          const converted = photos.map((p) => p.converted!);
          setSave({ phase: "uploading", done: 0, total: converted.length * 2 });
          images = await uploadImages(converted, (done, total) =>
            setSave({ phase: "uploading", done, total }),
          );
          uploadedRef.current = { key, images };
        }
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
        if (err.code === "NOT_FOUND") uploadedRef.current = null;
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
            {replacePhotos ? (
              <Badge icon="pencil" tone="primary">
                新しい写真に置き換え
              </Badge>
            ) : null}
          </div>
          {!replacePhotos ? (
            <>
              <ul className="grid grid-cols-4 gap-2" aria-label="現在の写真">
                {existingImages.map((img, i) => (
                  <li
                    key={img.id}
                    className="aspect-square overflow-hidden rounded-card border border-border"
                  >
                    <PhotoImage
                      src={img.thumbUrl}
                      alt={`現在の写真 ${i + 1}枚目`}
                      category={post.category}
                      className="size-full"
                    />
                  </li>
                ))}
              </ul>
              <p className="text-base text-text-muted">
                写真を追加・削除するときは、残したい写真も含めて新しい写真一式を選び直します（
                {LIMITS.postImagesMin}〜{LIMITS.postImagesMax}枚）。
              </p>
              <Button
                variant="secondary"
                leftIcon="image-plus"
                onClick={() => setReplacePhotos(true)}
                disabled={saving || blocked}
                className="self-start"
              >
                写真を変更する
              </Button>
            </>
          ) : (
            <>
              <PhotoPicker photos={photos} onChange={updatePhotos} disabled={saving} />
              <Button
                variant="ghost"
                leftIcon="x"
                onClick={cancelReplace}
                disabled={saving}
                className="self-start"
              >
                元の写真のままにする
              </Button>
            </>
          )}
        </Card>

        <Card as="section" aria-labelledby="edit-content" className="flex flex-col gap-3">
          <h2 id="edit-content" className="text-base font-semibold text-text">
            内容
          </h2>
          <ContentFields value={content} onChange={setContent} showCategoryError disabled={saving} />
        </Card>

        {blocked ? (
          <SuspendedNotice
            feature="post_create"
            detail="無料枠の上限に近づいたため、投稿の保存を一時的に停止しています。"
          />
        ) : null}
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
            disabled={
              blocked || !contentValid || !photosValid || photos.some((p) => p.status === "converting")
            }
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
