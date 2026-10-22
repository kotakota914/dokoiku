"use client";

/**
 * S-12 経路プラン（保存済み）。F-5-11 / F-5-12。
 * - タイムライン・地図（PlanDetail）と、各区間の「ナビを開始」（Google マップ URL を新しいタブで開く）
 * - 削除（DELETE /plans/{id}）
 * - 共有：リンクの共有（ヘッダー）と「しおり画像を共有」（GET /plans/{id}/image の PNG）
 */
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { ShareButton } from "@/components/share/ShareButton";
import { planShareText } from "@/components/share/shareLinks";
import { Button, ConfirmDialog, IconButton, PageHeader, useToast } from "@/components/ui";
import { ApiClientError, api, errorMessage } from "@/lib/api/client";
import { loginUrl } from "@/lib/auth/next-path";
import type { Plan, PlanNavSegment, SpotSummary } from "@/lib/domain/types";
import { formatDateJa } from "@/lib/utils/time";
import { buildNavSegments } from "./navUrl";
import { PlanDetail, useSpotsById } from "./PlanDetail";
import { normalizeCandidate } from "./types";

function currentPath(): string {
  if (typeof window === "undefined") return "/";
  const { pathname, search, hash } = window.location;
  return `${pathname}${search}${hash}`;
}

export interface PlanResultViewProps {
  plan: Plan;
  /** params.spotIds に対応するスポット（削除済みは含まれないことがある） */
  spots: SpotSummary[];
  /** GET /plans/{planId} の segments。無ければ buildNavSegments で作る */
  navSegments?: readonly PlanNavSegment[] | null;
}

export function PlanResultView({ plan, spots, navSegments }: PlanResultViewProps) {
  const router = useRouter();
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { params } = plan;

  const spotsById = useSpotsById(spots);
  const candidate = useMemo(() => normalizeCandidate(plan.result), [plan.result]);
  const segments = useMemo(
    () => (navSegments && navSegments.length > 0 ? navSegments : buildNavSegments(plan, spots)),
    [navSegments, plan, spots],
  );

  const listHref = `/lists/${encodeURIComponent(plan.wishlistId)}`;
  const planPath = `/plans/${encodeURIComponent(plan.id)}`;
  const spotCount = candidate.items.filter((i) => i.type === "spot").length;
  const shareTitle = `${formatDateJa(params.date)}のプラン`;
  const shareText = planShareText(formatDateJa(params.date), spotCount);

  const handleUnauthorized = useCallback(() => {
    router.push(loginUrl(currentPath()));
  }, [router]);

  async function remove() {
    setDeleting(true);
    try {
      await api.delete(planPath);
      toast.success("プランを削除しました");
      router.push(listHref);
    } catch (err) {
      setDeleting(false);
      setConfirmDelete(false);
      if (err instanceof ApiClientError && err.isUnauthorized) {
        handleUnauthorized();
        return;
      }
      toast.error(errorMessage(err, "削除に失敗しました"));
    }
  }

  /** 旅のしおり画像（PNG）を取得する。失敗は ShareButton がトーストにする */
  async function fetchItineraryImage(): Promise<Blob | null> {
    const res = await fetch(`/api/v1${planPath}/image`, { credentials: "same-origin" });
    if (res.status === 401) {
      handleUnauthorized();
      return null;
    }
    if (!res.ok) throw new Error("しおり画像を取得できませんでした");
    return res.blob();
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="保存済みプラン"
        backHref={listHref}
        actions={
          <>
            <ShareButton
              variant="icon"
              label="プランを共有"
              title={shareTitle}
              text={shareText}
              url={planPath}
            />
            <IconButton
              icon="trash-2"
              aria-label="プランを削除"
              variant="danger"
              onClick={() => setConfirmDelete(true)}
            />
          </>
        }
      />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-4">
        <PlanDetail params={params} candidate={candidate} spotsById={spotsById} navSegments={segments} />

        <div className="flex flex-col gap-2">
          <ShareButton
            label="しおり画像を共有"
            title={shareTitle}
            text={shareText}
            url={planPath}
            imageBlob={fetchItineraryImage}
            imageFileName={`plan-${params.date}.png`}
            className="w-full"
          />
          <Button
            variant="secondary"
            leftIcon="trash-2"
            fullWidth
            onClick={() => setConfirmDelete(true)}
            className="text-danger"
          >
            削除
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="プランを削除しますか"
        description="削除したプランは元に戻せません。"
        confirmLabel="削除"
        danger
        loading={deleting}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
