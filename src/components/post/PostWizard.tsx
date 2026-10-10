"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSystemStatus } from "@/components/system/SystemStatusProvider";
import {
  Badge,
  Button,
  Card,
  ErrorMessage,
  Icon,
  PageHeader,
  SuspendedNotice,
  useToast,
} from "@/components/ui";
import { ApiClientError, api, errorMessage } from "@/lib/api/client";
import { loginHref } from "@/components/spot/useRequireLogin";
import type { PostView, SpotSummary } from "@/lib/domain/types";
import { uploadImages, type UploadedImage } from "@/lib/images/upload";
import { createPostSchema, type CreatePostInput } from "@/lib/validation/schemas";
import { StepConfirm } from "./StepConfirm";
import { StepContent, validateContent } from "./StepContent";
import { StepLocation } from "./StepLocation";
import { StepPhotos, canProceedPhotos } from "./StepPhotos";
import {
  EMPTY_CONTENT,
  type ContentValue,
  type LocationChoice,
  type PhotoItem,
  type PhotoUpdater,
} from "./types";

export interface PostWizardProps {
  /** `/posts/new?spotId=` で開いたときの初期選択 */
  initialSpot?: Pick<SpotSummary, "id" | "name"> | null;
}

const STEPS = ["写真", "場所", "内容", "確認"] as const;
type StepIndex = 0 | 1 | 2 | 3;

type SubmitState =
  | { phase: "idle" }
  | { phase: "uploading"; done: number; total: number }
  | { phase: "posting" }
  | { phase: "error"; message: string; retryable: boolean }
  | { phase: "suspended" }
  | { phase: "conflict"; candidates: SpotSummary[] };

/** 409（CONFLICT）の details から既存スポット候補を取り出す。形が違っても落ちないようにする */
export function extractConflictCandidates(details: unknown): SpotSummary[] {
  const isSpot = (v: unknown): v is SpotSummary =>
    typeof v === "object" &&
    v !== null &&
    typeof (v as SpotSummary).id === "string" &&
    typeof (v as SpotSummary).name === "string";
  if (Array.isArray(details)) return details.filter(isSpot);
  if (typeof details === "object" && details !== null) {
    const obj = details as Record<string, unknown>;
    for (const key of ["candidates", "spots", "existing"]) {
      const v = obj[key];
      if (Array.isArray(v)) return v.filter(isSpot);
    }
  }
  return [];
}

function currentPathWithQuery(): string {
  if (typeof window === "undefined") return "/posts/new";
  return `${window.location.pathname}${window.location.search}`;
}

/** S-04 投稿作成（F-2-2）：写真 → 場所 → 内容 → 確認の 4 ステップ */
export function PostWizard({ initialSpot = null }: PostWizardProps) {
  const router = useRouter();
  const toast = useToast();
  const { loading: statusLoading, isSuspended } = useSystemStatus();
  const postSuspended = !statusLoading && isSuspended("post_create");

  const [step, setStep] = useState<StepIndex>(0);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [location, setLocation] = useState<LocationChoice | null>(
    initialSpot ? { spotId: initialSpot.id, spotName: initialSpot.name } : null,
  );
  const [content, setContent] = useState<ContentValue>(EMPTY_CONTENT);
  const [submit, setSubmit] = useState<SubmitState>({ phase: "idle" });

  // アップロード済みの画像（POST /posts だけが失敗したときに再アップロードしないため）
  const uploadedRef = useRef<{ key: string; images: UploadedImage[] } | null>(null);
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  // 離脱時に object URL を解放する
  useEffect(() => {
    return () => {
      for (const p of photosRef.current) if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
    };
  }, []);

  const updatePhotos = useCallback((updater: PhotoUpdater) => setPhotos((prev) => updater(prev)), []);

  const goToLogin = useCallback(() => {
    router.push(loginHref(currentPathWithQuery()));
  }, [router]);

  function photosKey(items: PhotoItem[]): string {
    return items.map((p) => p.id).join(",");
  }

  async function doSubmit() {
    if (!location || !canProceedPhotos(photos)) return;
    const validated = validateContent(content);
    if (!validated.ok) {
      setStep(2);
      return;
    }
    const converted = photos.map((p) => p.converted!);
    try {
      let images = uploadedRef.current?.key === photosKey(photos) ? uploadedRef.current.images : null;
      if (!images) {
        setSubmit({ phase: "uploading", done: 0, total: converted.length * 2 });
        images = await uploadImages(converted, (done, total) =>
          setSubmit({ phase: "uploading", done, total }),
        );
        uploadedRef.current = { key: photosKey(photos), images };
      }
      setSubmit({ phase: "posting" });
      const body: CreatePostInput = {
        ...(location.newSpot ? { newSpot: location.newSpot } : { spotId: location.spotId }),
        images,
        comment: validated.data.comment,
        category: validated.data.category,
        stayDuration: validated.data.stayDuration,
      };
      const parsed = createPostSchema.safeParse(body);
      if (!parsed.success) {
        setSubmit({
          phase: "error",
          message: parsed.error.issues[0]?.message ?? "入力内容を確認してください",
          retryable: false,
        });
        return;
      }
      const created = await api.post<PostView>("/posts", parsed.data);
      const spotId = created?.spotId ?? location.spotId;
      toast.success("投稿しました");
      if (spotId) router.push(`/spots/${encodeURIComponent(spotId)}`);
      else router.push("/");
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.isUnauthorized) {
          goToLogin();
          return;
        }
        if (err.isSuspended) {
          setSubmit({ phase: "suspended" });
          return;
        }
        if (err.code === "CONFLICT") {
          setSubmit({ phase: "conflict", candidates: extractConflictCandidates(err.details) });
          return;
        }
        if (err.code === "VALIDATION_ERROR" || err.code === "FORBIDDEN" || err.code === "NOT_FOUND") {
          // 一時アップロードが期限切れなどの場合は再アップロードから
          if (err.code === "NOT_FOUND") uploadedRef.current = null;
          setSubmit({ phase: "error", message: err.message, retryable: err.code === "NOT_FOUND" });
          return;
        }
      }
      setSubmit({ phase: "error", message: errorMessage(err, "投稿に失敗しました"), retryable: true });
    }
  }

  function pickConflictSpot(spot: SpotSummary) {
    setLocation({ spotId: spot.id, spotName: spot.name });
    setSubmit({ phase: "idle" });
  }

  const submitting = submit.phase === "uploading" || submit.phase === "posting";
  const progressLabel =
    submit.phase === "uploading"
      ? `写真をアップロード中 ${submit.done}/${submit.total}`
      : submit.phase === "posting"
        ? "投稿しています"
        : null;

  const notice = (() => {
    if (postSuspended || submit.phase === "suspended") {
      return (
        <SuspendedNotice
          feature="post_create"
          detail="無料枠の上限に近づいたため、新しい投稿を一時的に停止しています。閲覧は引き続き使えます。"
        />
      );
    }
    if (submit.phase === "error") {
      return (
        <ErrorMessage
          message={submit.message}
          onRetry={submit.retryable ? () => void doSubmit() : undefined}
          retryLabel="再試行"
        />
      );
    }
    if (submit.phase === "conflict") {
      return (
        <Card tone="warning" role="alert" className="flex flex-col gap-3">
          <div className="flex items-start gap-2">
            <Icon name="circle-alert" size={20} className="mt-0.5 text-warning" />
            <div className="flex flex-col gap-1">
              <p className="text-base font-medium text-text">同じ場所のスポットがあります</p>
              <p className="text-base text-text-muted">
                既存のスポットを選ぶと、そのスポットへの投稿として保存します。別の場所なら「戻る」で名前を変えてください。
              </p>
            </div>
          </div>
          {submit.candidates.length > 0 ? (
            <ul className="flex flex-col gap-2" aria-label="既存のスポット候補">
              {submit.candidates.map((s) => (
                <li key={s.id}>
                  <Button
                    variant="secondary"
                    leftIcon="map-pin"
                    fullWidth
                    onClick={() => pickConflictSpot(s)}
                  >
                    <span className="flex min-w-0 flex-1 flex-col text-left">
                      <span className="truncate">{s.name}</span>
                      <span className="text-sm text-text-muted">投稿 {s.postCount} 件</span>
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <Button variant="secondary" leftIcon="chevron-left" onClick={() => setStep(1)}>
              場所を選び直す
            </Button>
          )}
        </Card>
      );
    }
    return null;
  })();

  return (
    <div className="flex flex-1 flex-col bg-background">
      <PageHeader title="投稿する" backHref="/" />
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-4">
        <StepIndicator step={step} />
        <div className="rounded-card border border-border bg-surface p-4">
          {step === 0 ? (
            <StepPhotos photos={photos} onChange={updatePhotos} onNext={() => setStep(1)} />
          ) : step === 1 ? (
            <StepLocation
              value={location}
              onChange={(choice) => {
                setLocation(choice);
                if (submit.phase === "conflict") setSubmit({ phase: "idle" });
              }}
              onBack={() => setStep(0)}
              onNext={() => setStep(2)}
              onUnauthorized={goToLogin}
            />
          ) : step === 2 ? (
            <StepContent
              value={content}
              onChange={setContent}
              onBack={() => setStep(1)}
              onNext={() => setStep(3)}
            />
          ) : location ? (
            <StepConfirm
              photos={photos}
              location={location}
              content={content}
              onBack={() => {
                if (!submitting) setStep(2);
              }}
              onSubmit={() => void doSubmit()}
              submitting={submitting}
              progressLabel={progressLabel}
              disabled={postSuspended || submit.phase === "suspended" || submit.phase === "conflict"}
              notice={notice}
            />
          ) : (
            <ErrorMessage
              message="場所が選ばれていません"
              onRetry={() => setStep(1)}
              retryLabel="場所を選ぶ"
            />
          )}
        </div>
      </div>
    </div>
  );
}

function StepIndicator({ step }: { step: StepIndex }) {
  return (
    <nav aria-label="投稿の手順" className="flex flex-col gap-2">
      <p className="text-base text-text-muted">
        ステップ {step + 1}/{STEPS.length}
        <span className="ml-2 font-semibold text-text">{STEPS[step]}</span>
      </p>
      <ol className="flex gap-2">
        {STEPS.map((label, i) => (
          <li
            key={label}
            className="flex flex-1 flex-col gap-1"
            aria-current={i === step ? "step" : undefined}
          >
            <span
              aria-hidden="true"
              className={`h-1.5 rounded-full ${i <= step ? "bg-primary" : "bg-surface-muted"}`}
            />
            <span className="sr-only">
              {i + 1}. {label}
              {i < step ? "（完了）" : i === step ? "（現在）" : ""}
            </span>
          </li>
        ))}
      </ol>
      {step > 0 ? (
        <div className="flex flex-wrap gap-2">
          {STEPS.slice(0, step).map((label, i) => (
            <Badge key={label} icon="check" tone="success">
              {i + 1}. {label}
            </Badge>
          ))}
        </div>
      ) : null}
    </nav>
  );
}
