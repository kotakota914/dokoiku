/** 11.6：候補の点数（小さいほど良い） */
import { PLAN_DEFAULTS } from "@/lib/domain/constants";

/** 合計移動時間（分）＋ おすすめ時間帯から外れた時間（分）× 0.5 */
export function score(s: { totalTravelMin: number; offBestMinutes: number }): number {
  return s.totalTravelMin + s.offBestMinutes * PLAN_DEFAULTS.offBestHourPenalty;
}
