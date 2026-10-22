/**
 * 外部サービス（OpenRouteService / Google Routes / Nominatim / Gemini）、無料枠管理、通知、モック。サーバー専用。
 * 各モジュール自体は "server-only" を import しない（vitest から直接テストするため）。
 * API からはこの index 経由で使う。
 */
import "server-only";

export { estimateTravel, straightLine, FALLBACK_WALK_MAX_M } from "./fallback";
export { fetchMatrix, isOrsMode, ORS_PROFILE, type OrsMatrixResult, type OrsMode } from "./ors";
export {
  computeRouteMatrix,
  departureTimeRfc3339,
  GOOGLE_ROUTES_FIELD_MASK,
  type RouteMatrixElement,
} from "./google-routes";
export { generatePlanConditions, type GeminiChatInput, type GeminiChatSpot } from "./gemini";
export { mockEnabled } from "./mock";
export { searchPlaces, reverseGeocode, parseJpAddress, type NominatimOptions } from "./nominatim";
export {
  checkAndCount,
  isSuspended,
  assertNotSuspended,
  getSystemStatus,
  recordAbsoluteUsage,
  periodFor,
  suspendedMessage,
  type UsageDeps,
} from "./usage";
export { notify, type NotifyLevel } from "./notify";
export {
  getTravelMatrix,
  getLegsOffline,
  timeBucketFor,
  transitElementCount,
  travelMatrixIdOf,
  TIME_BUCKET_ANY,
  type TravelPoint,
  type TravelQuery,
  type TravelRepos,
  type TravelDeps,
  type TravelMatrixResult,
} from "./travel";
