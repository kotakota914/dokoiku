"use client";

/**
 * 経路プランのタイムライン（F-5-4、F-5-6、F-5-8）。
 * - 出発地 → スポット（番号つき）→ 昼食休憩 → 到着地 を縦に並べ、行間に移動時間と Google マップのリンクを置く
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
import type { TravelMode } from "@/lib/domain/constants";
import type { LatLng, PlanItem, PlanPlace } from "@/lib/domain/types";
import { googleMapsDirectionsUrl } from "@/lib/utils/geo";
import { hhmmToMinutes } from "@/lib/utils/time";
import { STAY_OPTIONS } from "./types";

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
  mode: TravelMode;
  /** 並び替え・滞在時間の変更を受け付けるか */
  editable?: boolean;
  /** 再計算中：行を薄くして操作を止める */
  busy?: boolean;
  /** 並び替え後の spot id の順 */
  onReorder?: (order: string[]) => void;
  onStayChange?: (spotId: string, stayMin: number) => void;
}

const LUNCH_ROW_ID = "__lunch__";
const DELETED_SPOT_NAME = "削除されたスポット";

type Point = LatLng & { name: string };

type Row =
  | {
      kind: "spot";
      id: string;
      index: number;
      number: number;
      item: Extract<PlanItem, { type: "spot" }>;
      spot: TimelineSpot | null;
      /** 直前の座標を持つ地点（Google マップのリンク元） */
      from: Point;
    }
  | { kind: "lunch"; id: string; index: number; item: Extract<PlanItem, { type: "lunch" }> };

function rowId(item: PlanItem, index: number): string {
  return item.type === "spot" ? item.spotId : `${LUNCH_ROW_ID}${index}`;
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
}: TimelineProps) {
  const originPoint = useMemo<Point>(
    () => ({ lat: origin.lat, lng: origin.lng, name: origin.label || "出発地" }),
    [origin],
  );
  const { rows, lastPoint } = useMemo(() => {
    const out: Row[] = [];
    let n = 0;
    let last: Point = originPoint;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (item.type === "lunch") {
        out.push({ kind: "lunch", id: rowId(item, index), index, item });
        continue;
      }
      n += 1;
      const spot = spotsById.get(item.spotId) ?? null;
      out.push({ kind: "spot", id: rowId(item, index), index, number: n, item, spot, from: last });
      if (spot) last = spot;
    }
    return { rows: out, lastPoint: last };
  }, [items, spotsById, originPoint]);
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

  // 各行の直前の移動時間：先頭は（出発時刻→最初の到着）、以降は直前行の travelMinToNext
  function travelBefore(index: number): number | null {
    if (index === 0) {
      const first = items[0];
      if (!first) return null;
      const diff = hhmmToMinutes(first.arrive) - hhmmToMinutes(startTime);
      return diff >= 0 ? diff : null;
    }
    return items[index - 1]?.travelMinToNext ?? null;
  }

  const lastItem = items[items.length - 1];

  return (
    <div className={cn("flex flex-col", busy && "opacity-60")} aria-busy={busy || undefined}>
      <EndpointRow icon="map-pin" label="出発地" name={origin.label || "出発地"} time={startTime} />

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
          <ol className="flex flex-col" aria-label="訪問順">
            {rows.map((row) => {
              const minutes = travelBefore(row.index);
              const segment =
                row.kind === "spot" && row.spot ? (
                  <TravelSegment minutes={minutes} mode={mode} from={row.from} to={row.spot} />
                ) : (
                  <TravelSegment minutes={minutes} mode={mode} />
                );
              const position = spotOrder.indexOf(row.id);
              return (
                <li key={row.id} className="flex flex-col">
                  {segment}
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
            minutes={lastItem?.travelMinToNext ?? null}
            mode={mode}
            from={lastPoint}
            to={{ lat: destination.lat, lng: destination.lng, name: destination.label || "到着地" }}
          />
          <EndpointRow icon="map-pin" label="到着地" name={destination.label || "到着地"} time={endAt} />
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

function EndpointRow({
  icon,
  label,
  name,
  time,
}: {
  icon: "map-pin";
  label: string;
  name: string;
  time: string;
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface-muted text-text-muted">
        <Icon name={icon} size={20} />
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

interface TravelSegmentProps {
  minutes: number | null;
  mode: TravelMode;
  from?: Point;
  to?: Point;
}

/** 行間の移動時間（footprints / car ＋ n 分）と Google マップのリンク（F-5-8） */
function TravelSegment({ minutes, mode, from, to }: TravelSegmentProps) {
  if (minutes === null && !(from && to)) return null;
  return (
    <div className="flex min-h-11 gap-3">
      <span aria-hidden="true" className="ml-[18px] w-px shrink-0 self-stretch bg-border" />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-base text-text-muted">
        {minutes !== null ? (
          <span className="inline-flex items-center gap-1">
            <Icon name={mode === "walking" ? "footprints" : "car"} size={16} />
            移動 {formatMinutes(minutes)}
          </span>
        ) : null}
        {from && to ? (
          <a
            href={googleMapsDirectionsUrl(from, to, "transit")}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1 text-primary underline-offset-2 hover:underline"
          >
            <Icon name="external-link" size={16} />
            Googleマップで経路を開く
            <span className="sr-only">
              （{from.name}から{to.name}へ）
            </span>
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
                  options={STAY_SELECT_OPTIONS}
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
