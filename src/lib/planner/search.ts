/**
 * 11.2 の 4：訪問順を全通り作る（最大 8! ＝ 40,320 通り。ADR-0021。2-opt は使わない）。
 * 順番の希望（orderHints：first / last / before / after）を満たさない順はここで落とす。
 */
import type { PlanPreferences } from "@/lib/domain/types";

/** 全順列（Heap's algorithm）。入力の順を先頭にし、同じ入力なら同じ順で返す（決定性） */
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

export type OrderHint = PlanPreferences["orderHints"][number];

/**
 * 対象に含まれるスポットに関する希望だけを残す。
 * before / after で relativeTo が対象に無い（除外・削除・時間切れ）ものは無視する。
 */
export function applicableHints(hints: readonly OrderHint[], ids: ReadonlySet<string>): OrderHint[] {
  return hints.filter((h) => {
    if (!ids.has(h.spotId)) return false;
    if (h.position === "before" || h.position === "after") {
      return !!h.relativeTo && ids.has(h.relativeTo) && h.relativeTo !== h.spotId;
    }
    return true;
  });
}

/** 訪問順（spotId の列）が順番の希望をすべて満たすか */
export function satisfiesHints(orderIds: readonly string[], hints: readonly OrderHint[]): boolean {
  if (hints.length === 0) return true;
  const pos = new Map<string, number>();
  for (let i = 0; i < orderIds.length; i += 1) pos.set(orderIds[i], i);
  for (const h of hints) {
    const p = pos.get(h.spotId);
    if (p === undefined) continue;
    switch (h.position) {
      case "first":
        if (p !== 0) return false;
        break;
      case "last":
        if (p !== orderIds.length - 1) return false;
        break;
      case "before": {
        const q = h.relativeTo ? pos.get(h.relativeTo) : undefined;
        if (q !== undefined && !(p < q)) return false;
        break;
      }
      case "after": {
        const q = h.relativeTo ? pos.get(h.relativeTo) : undefined;
        if (q !== undefined && !(p > q)) return false;
        break;
      }
    }
  }
  return true;
}

/** 訪問順の辞書順比較（同点のときの安定化。ADR-0021） */
export function compareOrderIds(a: readonly string[], b: readonly string[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return a.length - b.length;
}
