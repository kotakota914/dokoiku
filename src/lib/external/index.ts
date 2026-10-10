/**
 * 外部サービス（OpenRouteService / Nominatim）、無料枠管理、通知。サーバー専用。
 * 各モジュール自体は "server-only" を import しない（vitest から直接テストするため）。
 * API からはこの index 経由で使う。
 */
import "server-only";

export { estimateTravel, straightLine } from "./fallback";
export { fetchMatrix, fetchDirections, ORS_PROFILE, type OrsMatrixResult } from "./ors";
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
  getRouteGeometry,
  travelMatrixIdOf,
  type TravelPoint,
  type TravelRepos,
  type TravelDeps,
  type TravelMatrixResult,
  type RouteGeometryResult,
} from "./travel";
