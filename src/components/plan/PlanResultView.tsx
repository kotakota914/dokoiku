"use client";

/**
 * S-09 経路プラン（F-5-4〜F-5-8）。未保存（/lists/[listId]/plan/result）と保存済み（/plans/[planId]）で共用。
 * - 上部：日付、出発地 → 到着地、合計移動時間、終了時刻、概算バッジ（ADR-0018）
 * - 地図：RouteMap（経路線＋番号つきマーカー）
 * - タイムライン：並び替え・滞在時間変更 → POST /plans/recompute
 *   （再計算の結果が終了時刻を超えたら circle-alert で警告し、収まるまで保存できない）
 * - 入らなかった場所、保存 / 削除
 */
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { RouteMap } from "@/components/map";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  ErrorMessage,
  Icon,
  IconButton,
  PageHeader,
  SuspendedNotice,
  cn,
  formatMinutes,
  useToast,
} from "@/components/ui";
import { ApiClientError, api, errorMessage } from "@/lib/api/client";
import { loginUrl } from "@/lib/auth/next-path";
import { PLAN_DEFAULTS, TRAVEL_MODE_LABELS } from "@/lib/domain/constants";
import type { Plan, PlanResult } from "@/lib/domain/types";
import { buildRouteStops } from "@/lib/map/route";
import { isLunchSkipped } from "@/lib/planner";
import { formatDateJa, hhmmToMinutes } from "@/lib/utils/time";
import { Timeline, type TimelineSpot } from "./Timeline";
import { SKIP_REASON_LABELS, type PlanResultViewProps } from "./types";

const DELETED_SPOT_NAME = "削除されたスポット";

/** 再計算で終了時刻（params.endTime）を超えたか（サーバーは items をそのまま返すので画面で判定する） */
export function isOverEndTime(endAt: string, endTime: string): boolean {
  return hhmmToMinutes(endAt) > hhmmToMinutes(endTime);
}

function currentPath(): string {
  if (typeof window === "undefined") return "/";
  const { pathname, search, hash } = window.location;
  return `${pathname}${search}${hash}`;
}

export function PlanResultView({
  params,
  result: initialResult,
  spots,
  listId,
  saved,
  onResultChange,
}: PlanResultViewProps) {
  const router = useRouter();
  const toast = useToast();
  const [result, setResult] = useState<PlanResult>(initialResult);
  const [stayOverrides, setStayOverrides] = useState<Record<string, number>>({});
  const [recomputing, setRecomputing] = useState(false);
  const [recomputeError, setRecomputeError] = useState<string | null>(null);
  const [suspended, setSuspended] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const spotsById = useMemo(() => {
    const m = new Map<string, TimelineSpot>();
    for (const s of spots) m.set(s.id, { id: s.id, name: s.name, lat: s.lat, lng: s.lng });
    return m;
  }, [spots]);

  const stops = useMemo(
    () =>
      buildRouteStops({
        origin: params.origin,
        destination: params.destination,
        items: result.items,
        spotsById,
      }),
    [params.origin, params.destination, result.items, spotsById],
  );

  const listHref = `/lists/${encodeURIComponent(listId)}`;
  const backHref = saved ? listHref : `${listHref}/plan`;
  const editable = !saved;

  const handleUnauthorized = useCallback(() => {
    router.push(loginUrl(currentPath()));
  }, [router]);

  const applyResult = useCallback(
    (next: PlanResult) => {
      setResult(next);
      onResultChange?.(next);
    },
    [onResultChange],
  );

  async function recompute(order: string[], overrides: Record<string, number>) {
    setRecomputing(true);
    setRecomputeError(null);
    try {
      const next = await api.post<PlanResult>("/plans/recompute", {
        params,
        travelMatrixId: result.travelMatrixId,
        order,
        stayOverrides: overrides,
      });
      setStayOverrides(overrides);
      applyResult(next);
    } catch (err) {
      if (err instanceof ApiClientError && err.isUnauthorized) {
        handleUnauthorized();
        return;
      }
      if (err instanceof ApiClientError && err.isSuspended) {
        setSuspended(true);
        return;
      }
      setRecomputeError(errorMessage(err, "再計算に失敗しました"));
    } finally {
      setRecomputing(false);
    }
  }

  function currentOrder(): string[] {
    return result.items.filter((i) => i.type === "spot").map((i) => i.spotId);
  }

  function handleReorder(order: string[]) {
    void recompute(order, stayOverrides);
  }

  function handleStayChange(spotId: string, stayMin: number) {
    void recompute(currentOrder(), { ...stayOverrides, [spotId]: stayMin });
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const plan = await api.post<Plan>("/plans", { params, result });
      toast.success("プランを保存しました");
      router.push(`/plans/${encodeURIComponent(plan.id)}`);
    } catch (err) {
      if (err instanceof ApiClientError && err.isUnauthorized) {
        handleUnauthorized();
        return;
      }
      if (err instanceof ApiClientError && err.isSuspended) {
        setSuspended(true);
        return;
      }
      setSaveError(errorMessage(err, "保存に失敗しました"));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!saved) return;
    setDeleting(true);
    try {
      await api.delete(`/plans/${encodeURIComponent(saved.planId)}`);
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

  const overEndTime = isOverEndTime(result.endAt, params.endTime);
  // 昼食休憩を希望したが 11:30〜13:30 に空きが無く入らなかった（F-5-1。planner と同じ判定）
  const lunchSkipped = isLunchSkipped(params.lunchBreak, hhmmToMinutes(params.startTime), result.items);
  const originLabel = params.origin.label || "出発地";
  const destinationLabel = params.destination ? params.destination.label || "到着地" : "出発地に戻らない";
  const spotCount = result.items.filter((i) => i.type === "spot").length;

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title={saved ? "保存済みプラン" : "経路プラン"}
        backHref={backHref}
        actions={
          saved ? (
            <IconButton
              icon="trash-2"
              aria-label="プランを削除"
              variant="danger"
              onClick={() => setConfirmDelete(true)}
            />
          ) : null
        }
      />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-4">
        {suspended ? (
          <SuspendedNotice feature="route_planning" detail="表示中のプランはそのまま確認できます。" />
        ) : null}

        {/* 概要 */}
        <Card className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-base font-medium text-text">
              <Icon name="calendar" size={16} />
              {formatDateJa(params.date)}
            </span>
            <Badge icon={params.mode === "walking" ? "footprints" : "car"} tone="muted">
              {TRAVEL_MODE_LABELS[params.mode]}
            </Badge>
            {result.estimated ? (
              <Badge icon="triangle-alert" tone="warning">
                移動時間は概算です
              </Badge>
            ) : null}
          </div>
          <p className="flex flex-wrap items-center gap-1 text-base text-text">
            <Icon name="map-pin" size={16} />
            <span>{originLabel}</span>
            <Icon name="chevron-right" size={16} className="text-text-muted" />
            <span>{destinationLabel}</span>
          </p>
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-base">
            <div className="flex items-center gap-1">
              <dt className="text-text-muted">訪問</dt>
              <dd className="text-text">{spotCount}か所</dd>
            </div>
            <div className="flex items-center gap-1">
              <dt className="inline-flex items-center gap-1 text-text-muted">
                <Icon name="route" size={16} />
                合計移動時間
              </dt>
              <dd className="text-text">{formatMinutes(result.totalTravelMin)}</dd>
            </div>
            <div className="flex items-center gap-1">
              <dt className="inline-flex items-center gap-1 text-text-muted">
                <Icon name="clock" size={16} />
                終了
              </dt>
              <dd className={cn(overEndTime ? "font-semibold text-warning" : "text-text")}>{result.endAt}</dd>
            </div>
          </dl>
        </Card>

        {overEndTime ? (
          <Card tone="warning" role="alert" className="flex items-start gap-2">
            <Icon name="circle-alert" size={20} className="mt-0.5 text-warning" />
            <div className="flex flex-col gap-1">
              <p className="text-base font-medium text-text">
                終了時刻 {params.endTime} を超えています（終了 {result.endAt}）
              </p>
              <p className="text-base text-text-muted">
                {editable
                  ? "順番の入れ替えや滞在時間の短縮で終了時刻内に収めると保存できます。"
                  : "保存時の条件より遅く終わる内容です。"}
              </p>
            </div>
          </Card>
        ) : null}

        {lunchSkipped ? (
          <Card tone="muted" role="status" className="flex items-start gap-2">
            <Icon name="coffee" size={20} className="mt-0.5 text-text-muted" />
            <p className="text-base text-text">
              昼食休憩を入れられませんでした（{PLAN_DEFAULTS.lunchWindowStart}〜{PLAN_DEFAULTS.lunchWindowEnd}{" "}
              の間に空きがありません）
            </p>
          </Card>
        ) : null}

        {/* 地図（F-5-4） */}
        <div className="overflow-hidden rounded-card border border-border">
          <RouteMap geometry={result.geometry} stops={stops} className="h-64 w-full sm:h-80" />
        </div>

        {/* タイムライン */}
        <section aria-labelledby="plan-timeline-heading" className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 id="plan-timeline-heading" className="text-lg font-semibold text-text">
              タイムライン
            </h2>
          </div>
          {editable ? (
            <p className="text-base text-text-muted">
              順番の入れ替えや滞在時間の変更をすると、時刻を再計算します。
            </p>
          ) : null}
          {recomputeError ? (
            <ErrorMessage
              message={recomputeError}
              onRetry={() => void recompute(currentOrder(), stayOverrides)}
              retrying={recomputing}
            />
          ) : null}
          {result.items.length === 0 ? (
            <Card tone="muted">
              <p className="text-base text-text-muted">時間内に訪問できるスポットがありませんでした。</p>
            </Card>
          ) : (
            <Timeline
              items={result.items}
              spotsById={spotsById}
              origin={params.origin}
              destination={params.destination}
              startTime={params.startTime}
              endAt={result.endAt}
              mode={params.mode}
              editable={editable && !suspended}
              busy={recomputing}
              onReorder={handleReorder}
              onStayChange={handleStayChange}
            />
          )}
        </section>

        {/* 入らなかった場所（F-5-5） */}
        {result.skipped.length > 0 ? (
          <section aria-labelledby="plan-skipped-heading" className="flex flex-col gap-3">
            <h2 id="plan-skipped-heading" className="text-lg font-semibold text-text">
              時間が足りず入らなかった場所
            </h2>
            <ul className="flex flex-col gap-2">
              {result.skipped.map((s) => (
                <Card as="li" key={s.spotId} tone="muted" className="flex items-center gap-3 p-3">
                  <Icon name="circle-alert" size={20} className="text-text-muted" />
                  <span className="min-w-0 flex-1 truncate text-base text-text">
                    {spotsById.get(s.spotId)?.name ?? DELETED_SPOT_NAME}
                  </span>
                  <span className="text-base text-text-muted">
                    {SKIP_REASON_LABELS[s.reason] ?? s.reason}
                  </span>
                </Card>
              ))}
            </ul>
          </section>
        ) : null}

        {/* 保存 / 削除（F-5-7） */}
        {saved ? (
          <Button
            variant="secondary"
            leftIcon="trash-2"
            fullWidth
            onClick={() => setConfirmDelete(true)}
            className="text-danger"
          >
            削除
          </Button>
        ) : (
          <div className="flex flex-col gap-2">
            {saveError ? <ErrorMessage message={saveError} /> : null}
            <Button
              size="lg"
              leftIcon="save"
              fullWidth
              loading={saving}
              disabled={recomputing || suspended || overEndTime}
              onClick={() => void save()}
            >
              保存
            </Button>
          </div>
        )}
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
