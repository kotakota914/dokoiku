/**
 * 11.2：訪問順の全探索と、入りきらないスポットの除外、最大 3 案の選択。
 * 1. 除外指定（preferences.exclude → excluded）、行列に区間が無いスポット（no_route）、
 *    その日が定休日などで入れないスポット（opening_hours）を先に外す。
 * 2. 残りの訪問順を全通り作り、順番の希望を満たさない順・終了時刻を超える順・時刻の指定を守れない順を除く。
 * 3. 1 つも残らなければ、「必ず行きたい」以外から外したときに点数が最も良くなるものを 1 つ外して 2 へ戻る（time_limit）。
 *    「必ず行きたい」だけでも入らなければ候補 0 件にし、全スポットを time_limit で skipped にする。
 * 4. 残った順に点数（11.3）を付け、特徴の異なる最大 3 案（11.4）を返す。
 */
import type { LatLng, PlanCandidate, SkipReason } from "@/lib/domain/types";
import { spotKey } from "@/lib/utils/geo";
import { hhmmToMinutes, jstWeekday, minutesToHHMM } from "@/lib/utils/time";
import { notesFor, reasonFor, selectCandidates, type Evaluated } from "./candidates";
import { materialize, prepareSpots, simulate, type PreparedSpot, type ScheduleOptions } from "./schedule";
import { score } from "./score";
import { applicableHints, permutations, satisfiesHints } from "./search";
import type { PlannerInput, PlannerOutput, PlannerSpot, TravelMatrix } from "./types";

/** feasible でない候補の比較用：点数に終了時刻の超過分を大きく加える */
const INFEASIBLE_PENALTY = 1_000_000;

interface Evaluation {
  feasible: Evaluated[];
  /** feasible が無いときの比較用（超過分を大きく罰した点数）。feasible があれば最良の点数 */
  penalized: number;
}

function hasLeg(matrix: TravelMatrix, from: string, to: string): boolean {
  return from === to || matrix.has(`${from}|${to}`);
}

/**
 * 区間が無いスポットを除く。出発地から・到着地へ・他のスポットとの往復のどれかが欠けるものを、
 * 欠けが多い順に 1 つずつ外して、全ペアがそろうまで繰り返す。
 */
export function removeUnreachable(
  spots: readonly PlannerSpot[],
  ctx: { matrix: TravelMatrix; originKey: string; destinationKey: string | null },
): { kept: PlannerSpot[]; removed: PlannerSpot[] } {
  const kept = spots.slice();
  const removed: PlannerSpot[] = [];
  for (;;) {
    let worst: { spot: PlannerSpot; missing: number } | null = null;
    for (const s of kept) {
      const k = spotKey(s.id);
      let missing = 0;
      if (!hasLeg(ctx.matrix, ctx.originKey, k)) missing += 1;
      if (ctx.destinationKey && !hasLeg(ctx.matrix, k, ctx.destinationKey)) missing += 1;
      for (const o of kept) {
        if (o === s) continue;
        const ok = spotKey(o.id);
        if (!hasLeg(ctx.matrix, k, ok)) missing += 1;
        if (!hasLeg(ctx.matrix, ok, k)) missing += 1;
      }
      if (missing > 0 && (!worst || missing > worst.missing)) worst = { spot: s, missing };
    }
    if (!worst) return { kept, removed };
    kept.splice(kept.indexOf(worst.spot), 1);
    removed.push(worst.spot);
  }
}

/** その日に営業時間が全く無い（定休日、または開始〜終了に重ならない）スポットを除く */
export function removeClosed(
  spots: readonly PlannerSpot[],
  date: string,
  startMin: number,
  endMin: number,
): { kept: PlannerSpot[]; removed: PlannerSpot[] } {
  const wd = String(jstWeekday(date)) as "0" | "1" | "2" | "3" | "4" | "5" | "6";
  const kept: PlannerSpot[] = [];
  const removed: PlannerSpot[] = [];
  for (const s of spots) {
    const entry = s.openingHours?.[wd];
    if (entry === undefined) {
      kept.push(s);
      continue;
    }
    if (entry === null) {
      removed.push(s);
      continue;
    }
    const open = hhmmToMinutes(entry.open);
    const close = hhmmToMinutes(entry.close);
    // 営業中に到着できる余地があるか（開始時刻以降・終了時刻以前に open〜close が重なるか）
    if (close <= startMin || open > endMin) removed.push(s);
    else kept.push(s);
  }
  return { kept, removed };
}

/** 集合の全順列を評価する（順番の希望を満たさない順は数えない） */
function evaluate(spots: readonly PreparedSpot[], input: PlannerInput, opts: ScheduleOptions): Evaluation {
  const ids = new Set(spots.map((p) => p.spot.id));
  const hints = applicableHints(input.preferences.orderHints, ids);
  const priority = input.preferences.priority;
  const feasible: Evaluated[] = [];
  let penalized = Number.POSITIVE_INFINITY;
  for (const order of permutations(spots)) {
    const orderIds = order.map((p) => p.spot.id);
    if (!satisfiesHints(orderIds, hints)) continue;
    const sim = simulate(order, opts);
    const sc = score(
      {
        totalTravelMin: sim.totalTravelMin,
        offBestMinutes: sim.offBestMinutes,
        walkM: sim.walkM,
        spotCount: order.length,
      },
      priority,
    );
    if (sim.feasible) {
      feasible.push({ order, ids: orderIds, sim, score: sc });
    } else {
      const over = Math.max(0, sim.endMin - input.endMin);
      const p = sc + INFEASIBLE_PENALTY + over * 1000;
      if (p < penalized) penalized = p;
    }
  }
  if (feasible.length > 0) {
    penalized = Number.POSITIVE_INFINITY;
    for (const f of feasible) if (f.score < penalized) penalized = f.score;
  }
  return { feasible, penalized };
}

function geometryOf(
  input: Pick<PlannerInput, "origin" | "destination">,
  order: readonly PreparedSpot[],
): PlanCandidate["geometry"] {
  if (order.length === 0) return null;
  const points: LatLng[] = [];
  if (input.origin) points.push(input.origin);
  for (const p of order) points.push({ lat: p.spot.lat, lng: p.spot.lng });
  if (input.destination) points.push(input.destination);
  return { type: "LineString", coordinates: points.map((p) => [p.lng, p.lat]) };
}

export function planRoute(input: PlannerInput): PlannerOutput {
  const opts: ScheduleOptions = {
    startMin: input.startMin,
    endMin: input.endMin,
    originKey: input.originKey,
    destinationKey: input.destinationKey,
    lunchBreak: input.lunchBreak,
    date: input.date,
    mode: input.mode,
    stayOverrides: input.stayOverrides,
    matrix: input.matrix,
    preferences: input.preferences,
  };
  const skipped: { spotId: string; reason: SkipReason }[] = [];

  const exclude = new Set(input.preferences.exclude);
  const selected = input.spots.filter((s) => {
    if (!exclude.has(s.id)) return true;
    skipped.push({ spotId: s.id, reason: "excluded" });
    return false;
  });
  const targetCount = selected.length;
  const closed = removeClosed(selected, input.date, input.startMin, input.endMin);
  for (const s of closed.removed) skipped.push({ spotId: s.id, reason: "opening_hours" });
  const reach = removeUnreachable(closed.kept, opts);
  for (const s of reach.removed) skipped.push({ spotId: s.id, reason: "no_route" });

  let active = prepareSpots(reach.kept, opts);
  // 回れるスポットが 1 つも無い（すべて除外・削除・経路なし）なら案は出さない
  if (active.length === 0) return { candidates: [], skipped };
  let ev = evaluate(active, input, opts);
  while (ev.feasible.length === 0) {
    const optional = active.filter((p) => !p.spot.mustVisit);
    if (optional.length === 0) {
      // 「必ず行きたい」だけでも入らない（画面は「終了時刻を延ばすか、スポットを減らしてください」）
      for (const p of active) skipped.push({ spotId: p.spot.id, reason: "time_limit" });
      return { candidates: [], skipped };
    }
    let chosen: { spot: PreparedSpot; rest: PreparedSpot[]; ev: Evaluation } | null = null;
    for (const p of optional) {
      const rest = active.filter((x) => x !== p);
      const e = evaluate(rest, input, opts);
      if (
        !chosen ||
        e.penalized < chosen.ev.penalized ||
        (e.penalized === chosen.ev.penalized && p.spot.id < chosen.spot.spot.id)
      ) {
        chosen = { spot: p, rest, ev: e };
      }
    }
    const c = chosen!;
    skipped.push({ spotId: c.spot.spot.id, reason: "time_limit" });
    active = c.rest;
    ev = c.ev;
    if (active.length === 0) return { candidates: [], skipped };
  }

  const candidates = selectCandidates(ev.feasible, input.preferences.priority).map(
    (sel, i): PlanCandidate => {
      const { sim, order } = sel.ev;
      return {
        id: `c${i + 1}`,
        kind: sel.kind,
        label: sel.label,
        reason: reasonFor(sel.kind, sel.ev, targetCount),
        items: materialize(order, sim, opts),
        skipped: skipped.slice(),
        notes: notesFor(sim, input.mode),
        stats: {
          spotCount: order.length,
          totalTravelMin: sim.totalTravelMin,
          walkM: Math.round(sim.walkM),
          endAt: minutesToHHMM(sim.endMin),
          bestTimeHits: sim.bestTimeHits,
        },
        geometry: geometryOf(input, order),
      };
    },
  );
  return { candidates, skipped };
}
