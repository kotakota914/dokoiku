/**
 * 11.3：点数（小さいほど良い）。
 * 点数 ＝ 合計移動時間（分）× a ＋ おすすめ時間帯からずれた時間（分）× b ＋ 歩く距離（km）× c − 回れる場所の数 × d
 * 重みは「優先すること」ごとに PRIORITY_WEIGHTS（初期値）。
 */
import { PRIORITY_WEIGHTS, type Priority } from "@/lib/domain/constants";

export interface ScoreInput {
  totalTravelMin: number;
  offBestMinutes: number;
  /** 歩く距離（m） */
  walkM: number;
  spotCount: number;
}

export interface ScoreBreakdown {
  travel: number;
  offBest: number;
  walk: number;
  spots: number;
  total: number;
}

export function scoreBreakdown(s: ScoreInput, priority: Priority): ScoreBreakdown {
  const w = PRIORITY_WEIGHTS[priority];
  const travel = s.totalTravelMin * w.a;
  const offBest = s.offBestMinutes * w.b;
  const walk = (s.walkM / 1000) * w.c;
  const spots = s.spotCount * w.d;
  return { travel, offBest, walk, spots, total: travel + offBest + walk - spots };
}

export function score(s: ScoreInput, priority: Priority): number {
  return scoreBreakdown(s, priority).total;
}
