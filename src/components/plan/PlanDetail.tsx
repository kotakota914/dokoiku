"use client";

/**
 * 1 案の詳細（F-5-8、F-5-9）。S-11（選んだ案）と S-12（保存済み）で共用する。
 * 概要（日付・移動手段・合計移動・歩く距離・終了）、注意書き、地図（訪問順の線）、タイムライン、入らなかった場所。
 * 保存前の案には「ナビを開始」を置かない（navSegments は S-12 だけが渡す）。
 */
import { useMemo, type ReactNode } from "react";
import { RouteMap } from "@/components/map";
import { Badge, Card, Icon, cn, formatMinutes } from "@/components/ui";
import { PLAN_DEFAULTS, TRAVEL_MODE_LABELS } from "@/lib/domain/constants";
import type { PlanNavSegment, PlanParams, SpotSummary } from "@/lib/domain/types";
import { buildRouteStops } from "@/lib/map/route";
import { isLunchSkipped } from "@/lib/planner";
import { formatDateJa, hhmmToMinutes } from "@/lib/utils/time";
import { Timeline, type TimelineSpot } from "./Timeline";
import {
  SKIP_REASON_LABELS,
  TRAVEL_MODE_ICONS,
  formatWalk,
  isCandidateEstimated,
  type PlanCandidateView,
} from "./types";

export const DELETED_SPOT_NAME = "削除されたスポット";

/** 終了時刻（params.endTime）を超えたか（再計算の結果は画面で判定する） */
export function isOverEndTime(endAt: string, endTime: string): boolean {
  if (!endAt) return false;
  return hhmmToMinutes(endAt) > hhmmToMinutes(endTime);
}

export function useSpotsById(spots: readonly SpotSummary[]): Map<string, TimelineSpot> {
  return useMemo(() => {
    const m = new Map<string, TimelineSpot>();
    for (const s of spots) m.set(s.id, { id: s.id, name: s.name, lat: s.lat, lng: s.lng });
    return m;
  }, [spots]);
}

export interface PlanDetailProps {
  params: PlanParams;
  candidate: PlanCandidateView;
  spotsById: ReadonlyMap<string, TimelineSpot>;
  /** 並び替え・滞在時間の変更（S-11 の未保存の案だけ） */
  editable?: boolean;
  busy?: boolean;
  onReorder?: (order: string[]) => void;
  onStayChange?: (spotId: string, stayMin: number) => void;
  /** S-12：各区間の「ナビを開始」 */
  navSegments?: readonly PlanNavSegment[];
  /** タイムラインの上に出す案内（再計算のエラーなど） */
  timelineNotice?: ReactNode;
}

export function PlanDetail({
  params,
  candidate,
  spotsById,
  editable = false,
  busy = false,
  onReorder,
  onStayChange,
  navSegments,
  timelineNotice,
}: PlanDetailProps) {
  const stops = useMemo(
    () =>
      buildRouteStops({
        origin: params.origin,
        destination: params.destination,
        items: candidate.items,
        spotsById,
      }),
    [params.origin, params.destination, candidate.items, spotsById],
  );

  const { stats } = candidate;
  const overEndTime = isOverEndTime(stats.endAt, params.endTime);
  // 昼食休憩を希望したが 11:30〜13:30 に空きが無く入らなかった（planner と同じ判定）
  // planner が注意書き（notes）に同じ案内を入れているときは二重に出さない
  const lunchSkipped =
    isLunchSkipped(params.lunchBreak, hhmmToMinutes(params.startTime), candidate.items) &&
    !candidate.notes.some((n) => n.includes("昼食"));
  const estimated = isCandidateEstimated(candidate, params.mode);
  const originLabel = params.origin.label || "出発地";
  const destinationLabel = params.destination
    ? params.destination.label || "到着地"
    : "最後のスポットで終わります";
  const spotCount = candidate.items.filter((i) => i.type === "spot").length;

  return (
    <div className="flex flex-col gap-5">
      {/* 概要 */}
      <Card className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 text-base font-medium text-text">
            <Icon name="calendar" size={16} />
            {formatDateJa(params.date)}
          </span>
          <Badge icon={TRAVEL_MODE_ICONS[params.mode]} tone="muted">
            {TRAVEL_MODE_LABELS[params.mode]}
          </Badge>
          {estimated ? (
            <Badge icon="triangle-alert" tone="warning">
              移動時間は目安です
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
            <dd className="text-text">{formatMinutes(stats.totalTravelMin)}</dd>
          </div>
          <div className="flex items-center gap-1">
            <dt className="inline-flex items-center gap-1 text-text-muted">
              <Icon name="footprints" size={16} />
              歩く距離
            </dt>
            <dd className="text-text">{formatWalk(stats.walkM)}</dd>
          </div>
          <div className="flex items-center gap-1">
            <dt className="inline-flex items-center gap-1 text-text-muted">
              <Icon name="clock" size={16} />
              終了
            </dt>
            <dd className={cn(overEndTime ? "font-semibold text-warning" : "text-text")}>{stats.endAt}</dd>
          </div>
        </dl>
      </Card>

      {candidate.notes.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-label="注意">
          {candidate.notes.map((note, i) => (
            <Card as="li" key={`${i}-${note}`} tone="warning" className="flex items-start gap-2 p-3">
              <Icon name="triangle-alert" size={20} className="mt-0.5 text-warning" />
              <span className="text-base text-text">{note}</span>
            </Card>
          ))}
        </ul>
      ) : null}

      {overEndTime ? (
        <Card tone="warning" role="alert" className="flex items-start gap-2">
          <Icon name="circle-alert" size={20} className="mt-0.5 text-warning" />
          <div className="flex flex-col gap-1">
            <p className="text-base font-medium text-text">
              終了時刻 {params.endTime} を超えています（終了 {stats.endAt}）
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

      {/* 地図：訪問順にスポットを結んだ線（実際の道の形ではない。ADR-0016） */}
      <div className="flex flex-col gap-1">
        <div className="overflow-hidden rounded-card border border-border">
          <RouteMap geometry={candidate.geometry} stops={stops} className="h-64 w-full sm:h-80" />
        </div>
        <p className="text-base text-text-muted">線は訪問順を結んだもので、実際の道順ではありません。</p>
      </div>

      {/* タイムライン */}
      <section aria-labelledby="plan-timeline-heading" className="flex flex-col gap-3">
        <h2 id="plan-timeline-heading" className="text-lg font-semibold text-text">
          タイムライン
        </h2>
        {editable ? (
          <p className="text-base text-text-muted">
            順番の入れ替えや滞在時間の変更をすると、時刻を再計算します。
          </p>
        ) : null}
        {navSegments && navSegments.length > 0 ? (
          <p className="flex items-start gap-1 text-base text-text-muted">
            <Icon name="external-link" size={16} className="mt-1" />
            <span>「ナビを開始」は Googleマップ（外部サイト）を新しいタブで開きます。</span>
          </p>
        ) : null}
        {timelineNotice}
        {candidate.items.length === 0 ? (
          <Card tone="muted">
            <p className="text-base text-text-muted">時間内に訪問できるスポットがありませんでした。</p>
          </Card>
        ) : (
          <Timeline
            items={candidate.items}
            spotsById={spotsById}
            origin={params.origin}
            destination={params.destination}
            startTime={params.startTime}
            endAt={stats.endAt}
            mode={params.mode}
            editable={editable}
            busy={busy}
            onReorder={onReorder}
            onStayChange={onStayChange}
            navSegments={navSegments}
          />
        )}
      </section>

      {/* 入らなかった場所（F-5-9） */}
      {candidate.skipped.length > 0 ? (
        <section aria-labelledby="plan-skipped-heading" className="flex flex-col gap-3">
          <h2 id="plan-skipped-heading" className="text-lg font-semibold text-text">
            時間が足りず入らなかった場所
          </h2>
          <ul className="flex flex-col gap-2">
            {candidate.skipped.map((s) => (
              <Card as="li" key={s.spotId} tone="muted" className="flex flex-wrap items-center gap-3 p-3">
                <Icon name="circle-alert" size={20} className="text-text-muted" />
                <span className="min-w-0 flex-1 truncate text-base text-text">
                  {spotsById.get(s.spotId)?.name ?? DELETED_SPOT_NAME}
                </span>
                <span className="text-base text-text-muted">{SKIP_REASON_LABELS[s.reason] ?? s.reason}</span>
              </Card>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
