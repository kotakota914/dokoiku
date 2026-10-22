/**
 * 経路作成ロジック（11章 / ADR-0021）。純粋関数のみ。
 * 移動時間行列は src/lib/external/travel.ts で取得し、ここには行列だけを渡す。
 */
export type { PlannerSpot, PlannerInput, PlannerOutput, TravelMatrix, TravelLeg } from "./types";
export { computeStayMinutes } from "./stay";
export {
  bestHoursOf,
  bestTimeDeviation,
  isInBestTime,
  timeWindowDeviation,
  BEST_HOUR_RATIO,
} from "./bestHours";
export {
  buildSchedule,
  isLunchSkipped,
  isOpenAt,
  legMinutes,
  legOf,
  legMode,
  legWalkM,
  materialize,
  prepareSpots,
  simulate,
  toPlanLeg,
  travelMinutes,
  type PreparedSpot,
  type ScheduleOptions,
  type ScheduleResult,
  type Simulation,
} from "./schedule";
export { applicableHints, compareOrderIds, permutations, satisfiesHints, type OrderHint } from "./search";
export { score, scoreBreakdown, type ScoreBreakdown, type ScoreInput } from "./score";
export {
  candidateKindsFor,
  formatKm,
  notesFor,
  reasonFor,
  selectCandidates,
  NOTE_LUNCH_SKIPPED,
  NOTE_STRAIGHT_LINE,
  NOTE_TRANSIT_ESTIMATE,
  NOTE_WALK_FALLBACK,
  PRIORITY_TO_KIND,
  type Evaluated,
  type SelectedCandidate,
} from "./candidates";
export { planRoute, removeUnreachable, removeClosed } from "./plan";
