/**
 * 11.4：訪問順の候補を作る。
 * - 8 か所以下：全順列
 * - 9〜10 か所：最近傍法の初期解 → 2-opt＋Or-opt（改善がなくなるまで）。途中の改善解も候補に含める。
 * 距離は移動時間行列（出発地→…→到着地）の合計で測る。
 */
import { PLAN_DEFAULTS } from "@/lib/domain/constants";
import { spotKey } from "@/lib/utils/geo";
import type { PlannerSpot, TravelMatrix } from "./types";

export interface SearchContext {
  matrix: TravelMatrix;
  originKey: string;
  destinationKey: string | null;
}

/** 全順列（Heap's algorithm） */
export function permutations<T>(arr: readonly T[]): T[][] {
  const out: T[][] = [];
  const a = arr.slice();
  const n = a.length;
  if (n === 0) return [[]];
  const c = new Array<number>(n).fill(0);
  out.push(a.slice());
  let i = 0;
  while (i < n) {
    if (c[i] < i) {
      if (i % 2 === 0) [a[0], a[i]] = [a[i], a[0]];
      else [a[c[i]], a[i]] = [a[i], a[c[i]]];
      out.push(a.slice());
      c[i] += 1;
      i = 0;
    } else {
      c[i] = 0;
      i += 1;
    }
  }
  return out;
}

function legSec(matrix: TravelMatrix, from: string, to: string): number {
  if (from === to) return 0;
  const leg = matrix.get(`${from}|${to}`);
  return leg ? leg.durationSec : Number.POSITIVE_INFINITY;
}

/** 出発地→順→（到着地）の移動時間の合計（秒）。無い区間があれば Infinity */
export function pathCostSec(order: readonly PlannerSpot[], ctx: SearchContext): number {
  let cost = 0;
  let prev = ctx.originKey;
  for (const s of order) {
    const k = spotKey(s.id);
    cost += legSec(ctx.matrix, prev, k);
    prev = k;
  }
  if (ctx.destinationKey) cost += legSec(ctx.matrix, prev, ctx.destinationKey);
  return cost;
}

/** 最近傍法：出発地から、まだ訪れていない中で一番近いスポットを順に選ぶ */
export function nearestNeighborOrder(spots: readonly PlannerSpot[], ctx: SearchContext): PlannerSpot[] {
  const remaining = spots.slice();
  const order: PlannerSpot[] = [];
  let prev = ctx.originKey;
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestCost = Number.POSITIVE_INFINITY;
    for (let i = 0; i < remaining.length; i += 1) {
      const c = legSec(ctx.matrix, prev, spotKey(remaining[i].id));
      if (c < bestCost) {
        bestCost = c;
        bestIdx = i;
      }
    }
    const [next] = remaining.splice(bestIdx, 1);
    order.push(next);
    prev = spotKey(next.id);
  }
  return order;
}

/**
 * 2-opt（区間 [i, j] の反転）と Or-opt（長さ 1〜3 の区間の移動）を、改善がなくなるまで繰り返す。
 * 各反復で最も改善する手を採用する。改善のたびの解を順に返す（最後が最良）。
 */
export function twoOpt(initial: readonly PlannerSpot[], ctx: SearchContext): PlannerSpot[][] {
  let current = initial.slice();
  let currentCost = pathCostSec(current, ctx);
  const history: PlannerSpot[][] = [current.slice()];
  const n = current.length;
  let guard = 0;
  while (guard < 1000) {
    guard += 1;
    let best: PlannerSpot[] | null = null;
    let bestCost = currentCost;
    const consider = (candidate: PlannerSpot[]) => {
      const cost = pathCostSec(candidate, ctx);
      if (cost < bestCost) {
        bestCost = cost;
        best = candidate;
      }
    };
    // 2-opt：反転
    for (let i = 0; i < n - 1; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        consider(current.slice(0, i).concat(current.slice(i, j + 1).reverse(), current.slice(j + 1)));
      }
    }
    // Or-opt：長さ 1〜3 の区間を別の位置へ移す
    for (let len = 1; len <= 3 && len < n; len += 1) {
      for (let i = 0; i + len <= n; i += 1) {
        const segment = current.slice(i, i + len);
        const rest = current.slice(0, i).concat(current.slice(i + len));
        for (let k = 0; k <= rest.length; k += 1) {
          if (k === i) continue;
          consider(rest.slice(0, k).concat(segment, rest.slice(k)));
        }
      }
    }
    if (!best) break;
    current = best;
    currentCost = bestCost;
    history.push(current.slice());
  }
  return history;
}

function dedupe(orders: PlannerSpot[][]): PlannerSpot[][] {
  const seen = new Set<string>();
  const out: PlannerSpot[][] = [];
  for (const o of orders) {
    const k = o.map((s) => s.id).join(",");
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(o);
  }
  return out;
}

/** 訪問順の候補。最良と思われるものを先頭に返す */
export function candidateOrders(spots: readonly PlannerSpot[], ctx: SearchContext): PlannerSpot[][] {
  if (spots.length <= PLAN_DEFAULTS.exhaustiveMaxSpots) return permutations(spots);
  const history = twoOpt(nearestNeighborOrder(spots, ctx), ctx);
  // 最良（最後）を先頭に、途中の改善解も候補に含める
  return dedupe(history.slice().reverse());
}
