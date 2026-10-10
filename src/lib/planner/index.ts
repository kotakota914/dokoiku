/**
 * 経路作成ロジック（11章 / ADR-0010）。純粋関数のみ。
 * 外部 API（移動時間行列・経路形状）は src/lib/external/travel.ts で取得し、ここには行列だけを渡す。
 */
export type { PlannerSpot, PlannerInput, PlannerOutput, TravelMatrix, TravelLeg } from "./types";
export { computeStayMinutes } from "./stay";
export { bestHoursOf, isInBestTime, BEST_HOUR_RATIO } from "./bestHours";
export {
  buildSchedule,
  isLunchSkipped,
  isOpenAt,
  legMinutes,
  travelMinutes,
  type ScheduleOptions,
  type ScheduleResult,
} from "./schedule";
export {
  candidateOrders,
  heuristicOrders,
  permutations,
  nearestNeighborOrder,
  twoOpt,
  pathCostSec,
  type SearchContext,
} from "./search";
export { score } from "./score";
export { planRoute, removeUnreachable, removeClosed } from "./plan";
