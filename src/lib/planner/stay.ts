/** 11.1：滞在時間の決定 */
import {
  CATEGORY_DEFAULT_STAY_MIN,
  INTEREST_MULTIPLIER,
  LIMITS,
  PACE_MULTIPLIER,
  PLAN_DEFAULTS,
  type Interest,
  type Pace,
} from "@/lib/domain/constants";
import { roundToStep } from "@/lib/utils/time";
import type { PlannerSpot } from "./types";

/**
 * 投稿3件以上で中央値があればそれ、なければカテゴリの標準値。
 * 「重視するもの」に当てはまれば ×1.2、ペースの倍率を掛けて 5 分単位に丸める。
 */
export function computeStayMinutes(
  spot: Pick<PlannerSpot, "category" | "postCount" | "stayMinutesMedian">,
  interests: readonly Interest[],
  pace: Pace,
): number {
  const base =
    spot.postCount >= LIMITS.stayMedianMinPosts &&
    spot.stayMinutesMedian !== null &&
    spot.stayMinutesMedian > 0
      ? spot.stayMinutesMedian
      : CATEGORY_DEFAULT_STAY_MIN[spot.category];
  const interestMul = (interests as readonly string[]).includes(spot.category) ? INTEREST_MULTIPLIER : 1;
  const minutes = base * interestMul * PACE_MULTIPLIER[pace];
  return roundToStep(minutes, PLAN_DEFAULTS.stayRoundMinutes);
}
