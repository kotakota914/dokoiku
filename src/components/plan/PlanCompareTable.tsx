"use client";

/**
 * 経路案の比較（F-5-6、F-5-7）。最大 3 案を横並びにし、スマホでは横にスクロールする。
 * 各案：名前（label）、理由（reason）、回れる場所の数・合計移動時間・歩く距離・終了時刻・
 * おすすめの時間帯に合う場所の数・入らなかった場所、注意書き（triangle-alert）。
 */
import { Button, Card, Icon, cn, formatMinutes } from "@/components/ui";
import type { TimelineSpot } from "./Timeline";
import { DELETED_SPOT_NAME } from "./PlanDetail";
import { formatWalk, type PlanCandidateView } from "./types";

export interface PlanCompareTableProps {
  candidates: readonly PlanCandidateView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  spotsById: ReadonlyMap<string, TimelineSpot>;
  disabled?: boolean;
}

export function PlanCompareTable({
  candidates,
  selectedId,
  onSelect,
  spotsById,
  disabled = false,
}: PlanCompareTableProps) {
  return (
    <section aria-labelledby="plan-compare-heading" className="flex flex-col gap-3">
      {/* 画面の見出し（h1）が「経路案の比較」なので、同じ文言を繰り返さない */}
      <h2 id="plan-compare-heading" className="text-lg font-semibold text-text">
        経路案を選ぶ
      </h2>
      <ul
        aria-label="経路案"
        className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 lg:mx-0 lg:grid lg:grid-cols-3 lg:overflow-visible lg:px-0"
      >
        {candidates.map((c) => {
          const selected = c.id === selectedId;
          const skippedNames = c.skipped.map((s) => spotsById.get(s.spotId)?.name ?? DELETED_SPOT_NAME);
          return (
            <Card
              as="li"
              key={c.id}
              tone={selected ? "primary" : "default"}
              aria-label={c.label}
              className={cn(
                "flex w-72 shrink-0 snap-start flex-col gap-3 lg:w-auto",
                selected && "border-primary",
              )}
            >
              <div className="flex flex-col gap-1">
                <h3 className="text-base font-semibold text-text">{c.label}</h3>
                {c.reason ? <p className="text-base text-text-muted">{c.reason}</p> : null}
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-base">
                <dt className="text-text-muted">回れる場所</dt>
                <dd className="text-text">{c.stats.spotCount}か所</dd>
                <dt className="text-text-muted">合計移動時間</dt>
                <dd className="text-text">{formatMinutes(c.stats.totalTravelMin)}</dd>
                <dt className="text-text-muted">歩く距離</dt>
                <dd className="text-text">{formatWalk(c.stats.walkM)}</dd>
                <dt className="text-text-muted">終了時刻</dt>
                <dd className="text-text">{c.stats.endAt}</dd>
                <dt className="text-text-muted">おすすめの時間帯に合う場所</dt>
                <dd className="text-text">{c.stats.bestTimeHits}か所</dd>
                <dt className="text-text-muted">入らなかった場所</dt>
                <dd className="text-text">{skippedNames.length > 0 ? skippedNames.join("、") : "なし"}</dd>
              </dl>
              {c.notes.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {c.notes.map((note, i) => (
                    <li key={`${i}-${note}`} className="flex items-start gap-1 text-base text-text">
                      <Icon name="triangle-alert" size={16} className="mt-1 text-warning" />
                      <span>{note}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <Button
                variant={selected ? "primary" : "secondary"}
                leftIcon={selected ? "check" : undefined}
                aria-pressed={selected}
                aria-label={`${selected ? "表示中" : "この案を見る"}（${c.label}）`}
                disabled={disabled}
                onClick={() => onSelect(c.id)}
                className="mt-auto"
              >
                {selected ? "表示中" : "この案を見る"}
              </Button>
            </Card>
          );
        })}
      </ul>
    </section>
  );
}
