/** 11.2：おすすめ時間帯 */
import { LIMITS } from "@/lib/domain/constants";
import type { PlannerSpot } from "./types";

/** 最大値に対するこの割合以上の時間帯を「おすすめ」とする */
export const BEST_HOUR_RATIO = 0.6;

/**
 * 投稿が 5 件未満なら null（時間帯の指定なし）。
 * それ以外は hourHistogram の最大値の 60% 以上の時（0〜23）の集合。
 */
export function bestHoursOf(spot: Pick<PlannerSpot, "postCount" | "hourHistogram">): Set<number> | null {
  if (spot.postCount < LIMITS.bestHoursMinPosts) return null;
  const hist = spot.hourHistogram;
  if (!Array.isArray(hist) || hist.length === 0) return null;
  let max = 0;
  for (const v of hist) if (v > max) max = v;
  if (max <= 0) return null;
  const threshold = max * BEST_HOUR_RATIO;
  const out = new Set<number>();
  for (let h = 0; h < Math.min(24, hist.length); h += 1) {
    if (hist[h] >= threshold) out.add(h);
  }
  return out;
}

/**
 * 到着時刻（0:00 からの分）の「時」が集合に含まれるか。
 * bestHours が null（指定なし）のときは false（おすすめ時間帯の情報がない）。
 */
export function isInBestTime(arriveMin: number, bestHours: ReadonlySet<number> | null): boolean {
  if (!bestHours) return false;
  const hour = Math.floor(((arriveMin % 1440) + 1440) / 60) % 24;
  return bestHours.has(hour);
}

/**
 * 11.3 の「おすすめ時間帯からずれた時間（分）」：到着時刻から最も近いおすすめの時間帯までの分。
 * 時間帯の中に到着すれば 0。bestHours が null（指定なし）なら 0（ずれを数えない）。
 */
export function bestTimeDeviation(arriveMin: number, bestHours: ReadonlySet<number> | null): number {
  if (!bestHours || bestHours.size === 0) return 0;
  const t = ((arriveMin % 1440) + 1440) % 1440;
  let best = Number.POSITIVE_INFINITY;
  for (const h of bestHours) {
    const from = h * 60;
    const to = from + 60;
    const d = t < from ? from - t : t >= to ? t - to + 1 : 0;
    if (d < best) best = d;
  }
  return best === Number.POSITIVE_INFINITY ? 0 : best;
}

/**
 * AIと相談の「時刻の指定」（from〜to に到着）からのずれ（分）。範囲内なら 0。
 */
export function timeWindowDeviation(arriveMin: number, window: { fromMin: number; toMin: number }): number {
  if (arriveMin < window.fromMin) return window.fromMin - arriveMin;
  if (arriveMin > window.toMin) return arriveMin - window.toMin;
  return 0;
}
