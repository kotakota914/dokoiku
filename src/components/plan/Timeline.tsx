"use client";

/**
 * 経路案・経路プランのタイムライン（F-5-8、F-5-10、F-5-12）。
 * - 出発地 → スポット（番号つき）→ 昼食休憩 → 到着地 を縦に並べ、行間に次までの移動手段アイコンと移動時間を置く
 *   （移動時間は次のスポット・到着地の行の直前にまとめて出し、昼食休憩の行には出さない）
 * - 公共交通、または概算（next.estimated）の区間は「目安」と表示する。路線・乗換は表示しない（ADR-0016）
 * - 保存済みプラン（navSegments あり）だけ、各区間に「ナビを開始」（Google マップ）を置く。保存前の案には置かない
 * - 並び替え：ドラッグ（grip-vertical ハンドル、キーボード操作も可）と上下ボタンの両方
 * - 滞在時間：「変更」→ 5 分刻みの Select
 */
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMemo, useState } from "react";
import { Badge, Button, Icon, IconButton, Select, Spinner, cn, formatMinutes } from "@/components/ui";
import { TRAVEL_MODE_LABELS, type TravelMode } from "@/lib/domain/constants";
import type { LatLng, PlanItem, PlanNavSegment, PlanPlace } from "@/lib/domain/types";
import { hhmmToMinutes } from "@/lib/utils/time";
import { isSafeNavUrl, navAriaLabel } from "./navUrl";
import { PlanIcon } from "./PlanIcon";
import { STAY_OPTIONS, TRAVEL_MODE_ICONS } from "./types";

export interface TimelineSpot extends LatLng {
  id: string;
  name: string;
}

export interface TimelineProps {
  items: readonly PlanItem[];
  spotsById: ReadonlyMap<string, TimelineSpot>;
  origin: PlanPlace;
  destination: PlanPlace | null;
  startTime: string;
  endAt: string;
  /** プランの移動手段（区間に next が無いときに使う） */
  mode: TravelMode;
  /** 並び替え・滞在時間の変更を受け付けるか */
  editable?: boolean;
  /** 再計算中：行を薄くして操作を止める */
  busy?: boolean;
  /** 並び替え後の spot id の順 */
  onReorder?: (order: string[]) => void;
  onStayChange?: (spotId: string, stayMin: number) => void;
  /** 保存済みプランの「ナビを開始」（F-5-12）。保存前の案では渡さない */
  navSegments?: readonly PlanNavSegment[];
}

const LUNCH_ROW_ID = "__lunch__";
const DELETED_SPOT_NAME = "削除されたスポット";

type Row =
  | {
      kind: "spot";
      id: string;
      index: number;
      number: number;
      item: Extract<PlanItem, { type: "spot" }>;
      spot: TimelineSpot | null;
    }
  | { kind: "lunch"; id: string; index: number; item: Extract<PlanItem, { type: "lunch" }> };

interface SegmentInfo {
  minutes: number | null;
  mode: TravelMode;
  estimated: boolean;
}

function rowId(item: PlanItem, index: number): string {
  return item.type === "spot" ? item.spotId : `${LUNCH_ROW_ID}${index}`;
}

/** 次までの移動時間（v0.3 は next.travelMin。旧データは travelMinToNext） */
function legMinutes(item: PlanItem): number | null {
  return item.next?.travelMin ?? item.travelMinToNext ?? null;
}

export function Timeline({
  items,
  spotsById,
  origin,
  destination,
  startTime,
  endAt,
  mode,
  editable = false,
  busy = false,
  onReorder,
  onStayChange,
  navSegments,
}: TimelineProps) {
  const rows = useMemo(() => {
    const out: Row[] = [];
    let n = 0;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (item.type === "lunch") {
        out.push({ kind: "lunch", id: rowId(item, index), index, item });
        continue;
      }
      n += 1;
      out.push({
        kind: "spot",
        id: rowId(item, index),
        index,
        number: n,
        item,
        spot: spotsById.get(item.spotId) ?? null,
      });
    }
    return out;
  }, [items, spotsById]);
  const spotOrder = useMemo(() => rows.filter((r) => r.kind === "spot").map((r) => r.id), [rows]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const canEdit = editable && !busy;

  function move(spotId: string, direction: -1 | 1) {
    const from = spotOrder.indexOf(spotId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= spotOrder.length) return;
    onReorder?.(arrayMove(spotOrder, from, to));
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = rows.map((r) => r.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = arrayMove(ids, from, to).filter((id) => !id.startsWith(LUNCH_ROW_ID));
    if (next.join("|") === spotOrder.join("|")) return;
    onReorder?.(next);
  }

  /**
   * 直前のスポット（無ければ出発地）から items[index]（index === items.length なら到着地）までの区間。
   * 昼食行を挟んでも、そこまでの区間の合計を次のスポットの行に出す。
   */
  function segmentBefore(index: number): SegmentInfo {
    let prevSpot = index - 1;
    while (prevSpot >= 0 && items[prevSpot].type === "lunch") prevSpot -= 1;
    if (prevSpot < 0) {
      // 出発地からの最初の区間：出発時刻と最初の到着時刻の差（途中に昼食があればその分を除く）
      const first = items[0];
      if (!first) return { minutes: null, mode, estimated: mode === "transit" };
      let diff = hhmmToMinutes(first.arrive) - hhmmToMinutes(startTime);
      for (let k = 0; k < index; k += 1) {
        const it = items[k];
        if (it.type === "lunch") diff += legMinutes(it) ?? 0;
      }
      return { minutes: diff >= 0 ? diff : null, mode, estimated: mode === "transit" };
    }
    const leg = items[prevSpot].next;
    const legMode = leg?.mode ?? mode;
    const estimated = legMode === "transit" || leg?.estimated === true;
    const base = legMinutes(items[prevSpot]);
    if (base === null) return { minutes: null, mode: legMode, estimated };
    let total = base;
    for (let k = prevSpot + 1; k < index; k += 1) total += legMinutes(items[k]) ?? 0;
    return { minutes: total, mode: legMode, estimated };
  }

  function navTo(index: number): PlanNavSegment | null {
    if (!navSegments) return null;
    const seg =
      index >= items.length
        ? navSegments.find((s) => s.toIndex >= items.length)
        : navSegments.find((s) => s.toIndex === index);
    return seg && isSafeNavUrl(seg.navUrl) ? seg : null;
  }

  return (
    <div className={cn("flex flex-col", busy && "opacity-60")} aria-busy={busy || undefined}>
      <EndpointRow label="出発地" name={origin.label || "出発地"} time={startTime} />

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
          <ol className="flex flex-col" aria-label="訪問順">
            {rows.map((row) => {
              const position = spotOrder.indexOf(row.id);
              return (
                <li key={row.id} className="flex flex-col">
                  {/* 昼食行には移動時間を出さない（次のスポットの行にまとめる） */}
                  {row.kind === "spot" ? (
                    <TravelSegment segment={segmentBefore(row.index)} nav={navTo(row.index)} />
                  ) : null}
                  {row.kind === "lunch" ? (
                    <LunchRow item={row.item} />
                  ) : (
                    <SpotRow
                      id={row.id}
                      number={row.number}
                      name={row.spot?.name ?? DELETED_SPOT_NAME}
                      item={row.item}
                      editable={canEdit}
                      isFirst={position === 0}
                      isLast={position === spotOrder.length - 1}
                      onMoveUp={() => move(row.id, -1)}
                      onMoveDown={() => move(row.id, 1)}
                      onStayChange={(min) => onStayChange?.(row.id, min)}
                    />
                  )}
                </li>
              );
            })}
          </ol>
        </SortableContext>
      </DndContext>

      {destination ? (
        <>
          <TravelSegment
            segment={
              items.length > 0 ? segmentBefore(items.length) : { minutes: null, mode, estimated: false }
            }
            nav={navTo(items.length)}
          />
          <EndpointRow label="到着地" name={destination.label || "到着地"} time={endAt} />
        </>
      ) : null}
      {busy ? (
        <div className="flex items-center justify-center gap-2 py-3 text-base text-text-muted">
          <Spinner size={20} label="再計算中" />
          <span>時刻を再計算しています</span>
        </div>
      ) : null}
    </div>
  );
}

// ---------- 行 ----------

function EndpointRow({ label, name, time }: { label: string; name: string; time: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface-muted text-text-muted">
        <Icon name="map-pin" size={20} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-base text-text-muted">{label}</span>
        <span className="truncate text-base font-medium text-text">{name}</span>
      </div>
      <span className="inline-flex items-center gap-1 text-base text-text">
        <Icon name="clock" size={16} />
        {time}
      </span>
    </div>
  );
}

/** 行間の移動（移動手段アイコン＋移動時間、目安）と、保存済みなら「ナビを開始」 */
function TravelSegment({ segment, nav }: { segment: SegmentInfo; nav: PlanNavSegment | null }) {
  if (segment.minutes === null && !nav) return null;
  return (
    <div className="flex min-h-11 gap-3">
      <span aria-hidden="true" className="ml-[18px] w-px shrink-0 self-stretch bg-border" />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-base text-text-muted">
        {segment.minutes !== null ? (
          <span className="inline-flex items-center gap-1">
            <Icon name={TRAVEL_MODE_ICONS[segment.mode]} size={16} />
            <span className="sr-only">{TRAVEL_MODE_LABELS[segment.mode]}で</span>
            移動 {formatMinutes(segment.minutes)}
            {segment.estimated ? "（目安）" : null}
          </span>
        ) : null}
        {nav ? (
          <a
            href={nav.navUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={navAriaLabel(nav)}
            className="inline-flex min-h-11 items-center gap-1 rounded-card border border-border bg-surface px-3 font-medium text-primary-strong hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <PlanIcon name="navigation" size={16} />
            ナビを開始
            <Icon name="external-link" size={16} />
          </a>
        ) : null}
      </div>
    </div>
  );
}

function LunchRow({ item }: { item: Extract<PlanItem, { type: "lunch" }> }) {
  return (
    <div className="flex items-center gap-3 rounded-card border border-border bg-surface-muted px-3 py-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface text-text-muted">
        <Icon name="coffee" size={20} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-base font-medium text-text">昼食休憩</span>
        <span className="text-base text-text-muted">
          {item.arrive}〜{item.depart}
        </span>
      </div>
      <span className="inline-flex items-center gap-1 text-base text-text-muted">
        <Icon name="clock" size={16} />
        {formatMinutes(item.stayMin)}
      </span>
    </div>
  );
}

interface SpotRowProps {
  id: string;
  number: number;
  name: string;
  item: Extract<PlanItem, { type: "spot" }>;
  editable: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onStayChange: (stayMin: number) => void;
}

const STAY_SELECT_OPTIONS = STAY_OPTIONS.map((m) => ({ value: String(m), label: `${m}分` }));

function SpotRow({
  id,
  number,
  name,
  item,
  editable,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onStayChange,
}: SpotRowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({
      id,
      disabled: !editable,
    });
  const [editingStay, setEditingStay] = useState(false);
  const style = { transform: CSS.Transform.toString(transform), transition };
  // 5 分刻みの選択肢に無い滞在時間（ペース倍率など）でも現在値を選べるようにする
  const stayOptions = STAY_OPTIONS.includes(item.stayMin)
    ? STAY_SELECT_OPTIONS
    : [...STAY_SELECT_OPTIONS, { value: String(item.stayMin), label: `${item.stayMin}分` }].sort(
        (a, b) => Number(a.value) - Number(b.value),
      );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-start gap-2 rounded-card border border-border bg-surface px-3 py-3",
        isDragging && "shadow-[var(--shadow-sheet)]",
      )}
    >
      {editable ? (
        <button
          ref={setActivatorNodeRef}
          type="button"
          aria-label={`${name}を並び替える`}
          className="inline-flex min-h-11 min-w-11 cursor-grab touch-none items-center justify-center rounded-full text-text-muted hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          {...attributes}
          {...listeners}
        >
          <Icon name="grip-vertical" size={20} />
        </button>
      ) : null}
      <span className="mt-1 flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-base font-semibold text-on-primary">
        {number}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-base font-medium text-text">{name}</span>
        <span className="text-base text-text-muted">
          到着 {item.arrive}〜出発 {item.depart}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 text-base text-text">
            <Icon name="clock" size={16} />
            滞在 {formatMinutes(item.stayMin)}
          </span>
          {item.inBestTime ? (
            <Badge icon="check" tone="success">
              おすすめの時間帯
            </Badge>
          ) : null}
          {editable ? (
            editingStay ? (
              <label className="inline-flex items-center gap-2 text-base text-text">
                <span>滞在時間</span>
                <Select
                  aria-label={`${name}の滞在時間`}
                  options={stayOptions}
                  value={String(item.stayMin)}
                  className="w-28"
                  onChange={(e) => {
                    setEditingStay(false);
                    onStayChange(Number(e.target.value));
                  }}
                />
              </label>
            ) : (
              <Button variant="ghost" leftIcon="pencil" onClick={() => setEditingStay(true)}>
                変更
              </Button>
            )
          ) : null}
        </div>
      </div>
      {editable ? (
        <div className="flex flex-col">
          <IconButton icon="arrow-up" aria-label={`${name}を上へ`} onClick={onMoveUp} disabled={isFirst} />
          <IconButton icon="arrow-down" aria-label={`${name}を下へ`} onClick={onMoveDown} disabled={isLast} />
        </div>
      ) : null}
    </div>
  );
}
