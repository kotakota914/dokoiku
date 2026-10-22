/**
 * 保存済みデータを v0.3 の契約にそろえる純粋関数（memory / supabase の両方で使う）。
 * - v0.1 で保存したプランには candidates 由来の項目（id / kind / label / reason / notes / stats）と
 *   区間情報（PlanItem.next）が無く、条件には method / preferences が無い。読むときに既定値を補う。
 * - 既に v0.3 の形ならそのまま返す（値は変えない）。
 */
import {
  CANDIDATE_LABELS,
  PLAN_METHODS,
  PRIORITY_DEFAULT,
  TRAVEL_MODE_DEFAULT,
  TRAVEL_MODES,
  type CandidateKind,
  type PlanMethod,
  type TravelMode,
} from "@/lib/domain/constants";
import type {
  PlanItem,
  PlanLeg,
  PlanParams,
  PlanPreferences,
  PlanResult,
  PlanStats,
} from "@/lib/domain/types";

type Raw = Record<string, unknown>;

function isRecord(v: unknown): v is Raw {
  return typeof v === "object" && v !== null;
}

function asNumber(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function asString(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function asTravelMode(v: unknown): TravelMode {
  return typeof v === "string" && (TRAVEL_MODES as readonly string[]).includes(v)
    ? (v as TravelMode)
    : TRAVEL_MODE_DEFAULT;
}

/** 条件（PlanParams）。v0.1 の pace / interests は preferences へ移す */
export function normalizePlanParams(raw: unknown): PlanParams {
  const r = isRecord(raw) ? raw : {};
  const prefRaw = isRecord(r.preferences) ? r.preferences : {};
  const preferences: PlanPreferences = {
    pace: (asString(prefRaw.pace, asString(r.pace, "normal")) as PlanPreferences["pace"]) ?? "normal",
    interests: (Array.isArray(prefRaw.interests)
      ? prefRaw.interests
      : Array.isArray(r.interests)
        ? r.interests
        : []) as PlanPreferences["interests"],
    priority: asString(prefRaw.priority, PRIORITY_DEFAULT) as PlanPreferences["priority"],
    timeWindows: (Array.isArray(prefRaw.timeWindows)
      ? prefRaw.timeWindows
      : []) as PlanPreferences["timeWindows"],
    orderHints: (Array.isArray(prefRaw.orderHints)
      ? prefRaw.orderHints
      : []) as PlanPreferences["orderHints"],
    exclude: (Array.isArray(prefRaw.exclude) ? prefRaw.exclude : []) as PlanPreferences["exclude"],
  };
  const method =
    typeof r.method === "string" && (PLAN_METHODS as readonly string[]).includes(r.method)
      ? (r.method as PlanMethod)
      : "auto";
  return {
    listId: asString(r.listId, ""),
    spotIds: (Array.isArray(r.spotIds) ? r.spotIds : []) as string[],
    origin: (isRecord(r.origin)
      ? r.origin
      : { lat: 0, lng: 0, label: "" }) as unknown as PlanParams["origin"],
    destination: (isRecord(r.destination) ? r.destination : null) as unknown as PlanParams["destination"],
    date: asString(r.date, ""),
    startTime: asString(r.startTime, ""),
    endTime: asString(r.endTime, ""),
    mode: asTravelMode(r.mode),
    lunchBreak: r.lunchBreak === true,
    method,
    preferences,
  };
}

/** 区間（PlanLeg）。無ければ v0.1 の travelMinToNext から補う（不明なら null） */
function normalizeLeg(item: Raw, mode: TravelMode, estimated: boolean): PlanLeg | null {
  if (isRecord(item.next)) {
    const n = item.next;
    return {
      mode: asTravelMode(n.mode ?? mode),
      travelMin: asNumber(n.travelMin, 0),
      estimated: n.estimated === true,
      walkM: typeof n.walkM === "number" ? n.walkM : null,
    };
  }
  if (item.next === null) return null;
  const travelMin = item.travelMinToNext;
  if (typeof travelMin !== "number") return null;
  return { mode, travelMin, estimated, walkM: null };
}

function normalizeItem(raw: unknown, mode: TravelMode, estimated: boolean): PlanItem | null {
  if (!isRecord(raw)) return null;
  const travelMinToNext = typeof raw.travelMinToNext === "number" ? raw.travelMinToNext : null;
  const base = {
    arrive: asString(raw.arrive, ""),
    stayMin: asNumber(raw.stayMin, 0),
    depart: asString(raw.depart, ""),
    travelMinToNext,
    next: normalizeLeg(raw, mode, estimated),
  };
  if (raw.type === "lunch") return { type: "lunch", ...base };
  if (raw.type === "spot" && typeof raw.spotId === "string") {
    return { type: "spot", spotId: raw.spotId, ...base, inBestTime: raw.inBestTime === true };
  }
  return null;
}

/** 項目から統計を作る（v0.1 のプランには stats が無い） */
export function statsFromItems(
  items: PlanItem[],
  totalTravelMin: number | null,
  endAt: string | null,
): PlanStats {
  const legs = items.map((it) => it.next?.travelMin ?? it.travelMinToNext ?? 0);
  const last = items[items.length - 1];
  return {
    spotCount: items.filter((it) => it.type === "spot").length,
    totalTravelMin: totalTravelMin ?? legs.reduce((sum, v) => sum + v, 0),
    walkM: items.reduce((sum, it) => sum + (it.next?.walkM ?? 0), 0),
    endAt: endAt ?? last?.depart ?? "",
    bestTimeHits: items.filter((it) => it.type === "spot" && it.inBestTime).length,
  };
}

/**
 * 計算結果（PlanResult）。
 * @param raw 保存されている result（v0.1 / v0.3 どちらでも）
 * @param params 区間の移動手段を補うときに使う（省略時は transit）
 */
export function normalizePlanResult(raw: unknown, params?: Pick<PlanParams, "mode"> | null): PlanResult {
  const r = isRecord(raw) ? raw : {};
  const mode = asTravelMode(params?.mode);
  const estimated = r.estimated === true;
  const items = (Array.isArray(r.items) ? r.items : [])
    .map((it) => normalizeItem(it, mode, estimated))
    .filter((it): it is PlanItem => it !== null);
  const kind: CandidateKind = "fewest_moves";
  const totalTravelMin = typeof r.totalTravelMin === "number" ? r.totalTravelMin : null;
  const endAt = typeof r.endAt === "string" ? r.endAt : null;
  const stats: PlanStats = isRecord(r.stats)
    ? {
        spotCount: asNumber(r.stats.spotCount, items.filter((it) => it.type === "spot").length),
        totalTravelMin: asNumber(r.stats.totalTravelMin, totalTravelMin ?? 0),
        walkM: asNumber(r.stats.walkM, 0),
        endAt: asString(r.stats.endAt, endAt ?? ""),
        bestTimeHits: asNumber(r.stats.bestTimeHits, 0),
      }
    : statsFromItems(items, totalTravelMin, endAt);
  const resolvedKind = asString(r.kind, kind) as CandidateKind;
  return {
    id: asString(r.id, "c1"),
    kind: resolvedKind,
    label: asString(r.label, CANDIDATE_LABELS[resolvedKind] ?? CANDIDATE_LABELS[kind]),
    reason: asString(r.reason, ""),
    items,
    skipped: (Array.isArray(r.skipped) ? r.skipped : []) as PlanResult["skipped"],
    notes: (Array.isArray(r.notes) ? r.notes.filter((n) => typeof n === "string") : []) as string[],
    stats,
    geometry: (isRecord(r.geometry) ? r.geometry : null) as PlanResult["geometry"],
    totalTravelMin: totalTravelMin ?? stats.totalTravelMin,
    endAt: endAt ?? stats.endAt,
    travelMatrixId: asString(r.travelMatrixId, ""),
    estimated,
  };
}
