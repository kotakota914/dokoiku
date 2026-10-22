/**
 * 11.4：特徴の異なる最大 3 案を選ぶ。
 * - 移動が最も少ない案（fewest_moves）/ 回れる場所が最も多い案（most_spots）/ おすすめの時間帯に最も合う案（best_time）。
 *   「歩く距離を少なく」のときは fewest_moves の代わりに「歩く距離が最も少ない案」（least_walking）。
 * - 並び順はユーザーの「優先すること」に合う案を先頭にする。
 * - 同じ訪問順になった案はまとめる（kind / label はまとめた中で先頭の種類）。
 * - 同点は訪問順の辞書順で決める（同じ入力なら同じ出力。ADR-0021）。
 */
import {
  CANDIDATE_LABELS,
  PLAN_CANDIDATES_MAX,
  type CandidateKind,
  type Priority,
  type TravelMode,
} from "@/lib/domain/constants";
import { compareOrderIds } from "./search";
import type { PreparedSpot, Simulation } from "./schedule";

/** 全探索で feasible だった 1 つの訪問順 */
export interface Evaluated {
  order: PreparedSpot[];
  ids: string[];
  sim: Simulation;
  score: number;
}

export interface SelectedCandidate {
  kind: CandidateKind;
  label: string;
  /** まとめた種類（先頭が kind） */
  kinds: CandidateKind[];
  ev: Evaluated;
}

/** ユーザーの「優先すること」に対応する案の種類 */
export const PRIORITY_TO_KIND: Record<Priority, CandidateKind> = {
  fewer_moves: "fewest_moves",
  more_spots: "most_spots",
  best_time: "best_time",
  less_walking: "least_walking",
};

/** 出す案の種類と順番（優先することに合う案を先頭に） */
export function candidateKindsFor(priority: Priority): CandidateKind[] {
  const base: CandidateKind[] =
    priority === "less_walking"
      ? ["least_walking", "most_spots", "best_time"]
      : ["fewest_moves", "most_spots", "best_time"];
  const first = PRIORITY_TO_KIND[priority];
  return [first, ...base.filter((k) => k !== first)];
}

type Comparator = (a: Evaluated, b: Evaluated) => number;

function chain(...cmps: Comparator[]): Comparator {
  return (a, b) => {
    for (const c of cmps) {
      const r = c(a, b);
      if (r !== 0) return r;
    }
    return 0;
  };
}

const byScore: Comparator = (a, b) => a.score - b.score;
const byOrder: Comparator = (a, b) => compareOrderIds(a.ids, b.ids);

const COMPARATORS: Record<CandidateKind, Comparator> = {
  fewest_moves: chain((a, b) => a.sim.totalTravelMin - b.sim.totalTravelMin, byScore, byOrder),
  least_walking: chain((a, b) => a.sim.walkM - b.sim.walkM, byScore, byOrder),
  most_spots: chain((a, b) => b.order.length - a.order.length, byScore, byOrder),
  best_time: chain(
    (a, b) => b.sim.bestTimeHits - a.sim.bestTimeHits,
    (a, b) => a.sim.offBestMinutes - b.sim.offBestMinutes,
    byScore,
    byOrder,
  ),
};

function bestBy(list: readonly Evaluated[], cmp: Comparator): Evaluated {
  let best = list[0];
  for (let i = 1; i < list.length; i += 1) if (cmp(list[i], best) < 0) best = list[i];
  return best;
}

/** feasible な訪問順の集合から最大 PLAN_CANDIDATES_MAX 案を選ぶ。空なら空配列 */
export function selectCandidates(feasible: readonly Evaluated[], priority: Priority): SelectedCandidate[] {
  if (feasible.length === 0) return [];
  const out: SelectedCandidate[] = [];
  const byKey = new Map<string, SelectedCandidate>();
  for (const kind of candidateKindsFor(priority)) {
    const ev = bestBy(feasible, COMPARATORS[kind]);
    const key = ev.ids.join(",");
    const existing = byKey.get(key);
    if (existing) {
      existing.kinds.push(kind);
      continue;
    }
    const c: SelectedCandidate = { kind, label: CANDIDATE_LABELS[kind], kinds: [kind], ev };
    byKey.set(key, c);
    out.push(c);
    if (out.length >= PLAN_CANDIDATES_MAX) break;
  }
  return out;
}

/** 歩く距離の表示（km、小数 1 桁） */
export function formatKm(walkM: number): string {
  return (Math.round(walkM / 100) / 10).toFixed(1);
}

/** 各案の説明文（点数の内訳から。F-5-6） */
export function reasonFor(kind: CandidateKind, ev: Evaluated, targetCount: number): string {
  const { sim, order } = ev;
  switch (kind) {
    case "fewest_moves":
      return `近い場所どうしをまとめ、移動を合計${sim.totalTravelMin}分に抑えました`;
    case "least_walking":
      return `歩く距離を${formatKm(sim.walkM)}kmに抑えました`;
    case "most_spots":
      return order.length >= targetCount
        ? `${order.length}か所すべてを回れます`
        : `${targetCount}か所のうち${order.length}か所を回れます`;
    case "best_time":
      return sim.bestTimeHits > 0
        ? `おすすめの時間帯に${sim.bestTimeHits}か所で着きます`
        : "おすすめの時間帯からのずれが最も小さい案です";
  }
}

export const NOTE_TRANSIT_ESTIMATE = "公共交通の移動時間は目安です";
export const NOTE_WALK_FALLBACK = "一部の区間は徒歩で計算しています";
export const NOTE_STRAIGHT_LINE = "移動時間は直線距離からの概算です";
export const NOTE_LUNCH_SKIPPED = "11:30〜13:30 に昼食休憩を入れる空きがありませんでした";

/** 案の注意書き（該当するものだけ、固定の順） */
export function notesFor(
  sim: Pick<Simulation, "estimated" | "walkFallback" | "lunchSkipped">,
  mode: TravelMode,
): string[] {
  const notes: string[] = [];
  if (mode === "transit") notes.push(NOTE_TRANSIT_ESTIMATE);
  if (sim.walkFallback) notes.push(NOTE_WALK_FALLBACK);
  if (sim.estimated) notes.push(NOTE_STRAIGHT_LINE);
  if (sim.lunchSkipped) notes.push(NOTE_LUNCH_SKIPPED);
  return notes;
}
