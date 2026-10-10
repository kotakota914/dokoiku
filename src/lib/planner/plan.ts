/**
 * 11.4〜11.7：訪問順の探索と、入りきらないスポットの除外。
 * 1. 行列に区間が無いスポット（no_route）と、その日が定休日などで入れないスポット（opening_hours）を先に外す。
 * 2. 候補順を作り、feasible なものから点数最小を採用する。
 * 3. 残らなければ、「必ず行きたい」以外から外したときに点数が最も良くなるものを 1 つ外して繰り返す（time_limit）。
 * 4. 「必ず行きたい」だけでも入らなければ items を空にし、全スポットを time_limit で skipped にする。
 */
import type { SkipReason } from "@/lib/domain/types";
import { spotKey } from "@/lib/utils/geo";
import { hhmmToMinutes, jstWeekday, minutesToHHMM } from "@/lib/utils/time";
import { buildSchedule, type ScheduleResult } from "./schedule";
import { candidateOrders, type SearchContext } from "./search";
import { score } from "./score";
import type { PlannerInput, PlannerOutput, PlannerSpot, TravelMatrix } from "./types";

/** 候補集合の評価結果 */
interface Evaluation {
  /** feasible な最良の順と結果。無ければ null */
  best: { order: PlannerSpot[]; result: ScheduleResult } | null;
  /** feasible が無いときの比較用（超過分を大きく罰した点数） */
  penalized: number;
}

/** feasible でない候補の比較用：点数に終了時刻の超過分を大きく加える */
const INFEASIBLE_PENALTY = 1_000_000;

function hasLeg(matrix: TravelMatrix, from: string, to: string): boolean {
  return from === to || matrix.has(`${from}|${to}`);
}

/**
 * 区間が無いスポットを除く。出発地から・到着地へ・他のスポットとの往復のどれかが欠けるものを、
 * 欠けが多い順に 1 つずつ外して、全ペアがそろうまで繰り返す。
 */
export function removeUnreachable(
  spots: readonly PlannerSpot[],
  ctx: SearchContext,
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

function evaluate(spots: readonly PlannerSpot[], input: PlannerInput, ctx: SearchContext): Evaluation {
  const opts = {
    startMin: input.startMin,
    endMin: input.endMin,
    originKey: input.originKey,
    destinationKey: input.destinationKey,
    lunchBreak: input.lunchBreak,
    date: input.date,
    stayOverrides: input.stayOverrides,
    matrix: input.matrix,
    interests: input.interests,
    pace: input.pace,
  };
  let candidates: PlannerSpot[][];
  if (input.fixedOrder) {
    const byId = new Map(spots.map((s) => [s.id, s]));
    const ordered = input.fixedOrder.map((id) => byId.get(id)).filter((s): s is PlannerSpot => !!s);
    // fixedOrder に無いスポットは末尾に付ける
    const rest = spots.filter((s) => !input.fixedOrder!.includes(s.id));
    candidates = [ordered.concat(rest)];
  } else {
    candidates = candidateOrders(spots, ctx);
  }

  let best: Evaluation["best"] = null;
  let bestScore = Number.POSITIVE_INFINITY;
  let penalized = Number.POSITIVE_INFINITY;
  for (const order of candidates) {
    const result = buildSchedule(order, opts);
    const sc = score(result);
    if (result.feasible) {
      if (sc < bestScore) {
        bestScore = sc;
        best = { order, result };
      }
    } else {
      const over = Math.max(0, result.endMin - input.endMin);
      const p = sc + INFEASIBLE_PENALTY + over * 1000;
      if (p < penalized) penalized = p;
    }
  }
  if (best) penalized = bestScore;
  return { best, penalized };
}

export function planRoute(input: PlannerInput): PlannerOutput {
  const ctx: SearchContext = { matrix: input.matrix, originKey: input.originKey, destinationKey: input.destinationKey };
  const skipped: { spotId: string; reason: SkipReason }[] = [];

  const closed = removeClosed(input.spots, input.date, input.startMin, input.endMin);
  for (const s of closed.removed) skipped.push({ spotId: s.id, reason: "opening_hours" });
  const reach = removeUnreachable(closed.kept, ctx);
  for (const s of reach.removed) skipped.push({ spotId: s.id, reason: "no_route" });

  let active = reach.kept;
  let ev = evaluate(active, input, ctx);
  while (!ev.best) {
    const optional = active.filter((s) => !s.mustVisit);
    if (optional.length === 0) {
      // 「必ず行きたい」だけでも入らない（API 側で「終了時刻を延ばすか、スポットを減らしてください」にする）
      for (const s of active) skipped.push({ spotId: s.id, reason: "time_limit" });
      return { items: [], skipped, totalTravelMin: 0, endAt: minutesToHHMM(input.startMin) };
    }
    let chosen: { spot: PlannerSpot; ev: Evaluation } | null = null;
    for (const s of optional) {
      const rest = active.filter((x) => x !== s);
      const e = evaluate(rest, input, ctx);
      if (!chosen || e.penalized < chosen.ev.penalized) chosen = { spot: s, ev: e };
    }
    // optional.length > 0 なので chosen は必ずある
    const c = chosen!;
    skipped.push({ spotId: c.spot.id, reason: "time_limit" });
    active = active.filter((x) => x !== c.spot);
    ev = c.ev;
  }

  const { result } = ev.best;
  return {
    items: result.items,
    skipped,
    totalTravelMin: result.totalTravelMin,
    endAt: minutesToHHMM(result.endMin),
  };
}
