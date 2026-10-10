/**
 * 場所検索（F-2-7 / F-5-1、Q6）：自前DB優先＋Nominatim。
 * 1. 自前DBのスポット検索（人気順、最大 DB_RESULT_LIMIT 件）
 * 2. 外部検索が有効・停止中でなければ、グローバルのレート制限（1秒1回）→ 無料枠の加算 → Nominatim
 *    - レート制限に掛かったら 429（RATE_LIMITED）
 *    - 停止中・無効・失敗（UPSTREAM）のときは externalUnavailable: true で自前DBの結果だけ返す（API は 200）
 * 3. 自前DBと同じ場所（DUPLICATE_RADIUS_M 以内かつ normalizeName 一致）の外部候補は除く
 *
 * Repository の契約だけに依存し、"server-only" は import しない（vitest から直接テストするため）。
 */
import { ApiError } from "@/lib/api/errors";
import { checkRateLimit } from "@/lib/api/ratelimit";
import { serverConfig } from "@/lib/config";
import { LIMITS } from "@/lib/domain/constants";
import type { PlaceCandidate, PlacesSearchResponse, SpotSummary } from "@/lib/domain/types";
import { searchPlaces, type NominatimOptions } from "@/lib/external/nominatim";
import { checkAndCount, isSuspended } from "@/lib/external/usage";
import type { Repository } from "@/lib/repo/types";
import { haversineM, normalizeName } from "@/lib/utils/geo";

/** 自前DBから返す最大件数 */
export const DB_RESULT_LIMIT = 10;
/** 外部候補を自前DBと「同じ場所」とみなす距離（メートル） */
export const DUPLICATE_RADIUS_M = 50;
/** 外部検索のグローバルなレート制限キー（9.1：外部検索は 1 秒に 1 回まで） */
export const EXTERNAL_RATE_LIMIT_KEY = "places:external";

export interface PlacesSearchInput {
  q: string;
  lat?: number;
  lng?: number;
}

export interface PlacesDeps {
  /** テストで時刻を固定する */
  now?: Date;
  /** テストで Nominatim の fetch を差し替える */
  fetchImpl?: NominatimOptions["fetchImpl"];
  /** テストで有効・無効を切り替える。既定は serverConfig.nominatimEnabled */
  nominatimEnabled?: boolean;
}

export function toDbCandidate(s: SpotSummary): PlaceCandidate {
  return {
    source: "db",
    id: s.id,
    name: s.name,
    lat: s.lat,
    lng: s.lng,
    address: null,
    prefecture: s.prefecture,
    city: s.city,
  };
}

/** 自前DBの候補と同じ場所（50m 以内かつ正規化した名前が一致）か */
export function isSamePlace(external: PlaceCandidate, db: PlaceCandidate): boolean {
  return (
    normalizeName(external.name) === normalizeName(db.name) && haversineM(external, db) <= DUPLICATE_RADIUS_M
  );
}

export function dedupeExternal(external: PlaceCandidate[], db: PlaceCandidate[]): PlaceCandidate[] {
  return external.filter((e) => !db.some((d) => isSamePlace(e, d)));
}

/** GET /places/search */
export async function searchPlaceCandidates(
  repo: Pick<Repository, "spots" | "apiUsage">,
  input: PlacesSearchInput,
  deps: PlacesDeps = {},
): Promise<PlacesSearchResponse> {
  const now = deps.now ?? new Date();
  const q = input.q.trim();

  const page = await repo.spots.search({ keyword: q, sort: "popular", paging: { limit: DB_RESULT_LIMIT } });
  const dbResults = page.items.map(toDbCandidate);

  const enabled = deps.nominatimEnabled ?? serverConfig.nominatimEnabled;
  if (!enabled || (await isSuspended(repo.apiUsage, "external_search", now))) {
    return { results: dbResults, externalUnavailable: true };
  }

  // 停止中でないときだけレート制限を数える（停止中の画面は外部検索ボタンを出さないため）
  if (!checkRateLimit(EXTERNAL_RATE_LIMIT_KEY, LIMITS.externalSearchPerSecond, 1000, now.getTime())) {
    throw ApiError.rateLimited("外部の場所検索は1秒に1回までです。少し待ってからもう一度お試しください");
  }

  let external: PlaceCandidate[];
  try {
    await checkAndCount(repo.apiUsage, "nominatim", 1, { now });
    const near =
      input.lat !== undefined && input.lng !== undefined ? { lat: input.lat, lng: input.lng } : undefined;
    external = await searchPlaces(q, { fetchImpl: deps.fetchImpl, near });
  } catch (err) {
    if (err instanceof ApiError && (err.code === "FEATURE_SUSPENDED" || err.code === "UPSTREAM_ERROR")) {
      // 無料枠の到達や外部側の失敗は、自前DBの結果だけで 200 を返す（F-2 例外）
      console.warn(`[places] external search unavailable: ${err.code} ${err.message}`);
      return { results: dbResults, externalUnavailable: true };
    }
    throw err;
  }

  return { results: [...dbResults, ...dedupeExternal(external, dbResults)], externalUnavailable: false };
}
