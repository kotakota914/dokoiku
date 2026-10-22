/**
 * F-8-8 / ADR-0026：EXTERNAL_API_MOCK=true のとき、外部 API（ORS / Google Routes / Nominatim / Gemini）を
 * mock-data/external/*.json の記録済みの結果に置き換える。使用量（api_usage）は数えない。
 * - 移動時間：travel-matrix.json の legs（キー `${mode}|${fromKey}|${toKey}`）。無ければ直線距離からの概算（estimated=true）
 * - 場所検索：nominatim.json の search（検索語 → 候補）/ reverse（`lat,lng` 小数 3 桁 → 候補）。無ければ空
 * - AIと相談：gemini.json の固定応答。無ければ unclear の定型応答
 * ファイルはプロセス内で 1 回だけ読む（無い・壊れている場合は null）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serverConfig } from "@/lib/config";
import type { TravelMode } from "@/lib/domain/constants";
import type { LatLng, PlaceCandidate } from "@/lib/domain/types";
import type { TravelLeg } from "@/lib/planner/types";
import { estimateTravel } from "./fallback";

export const MOCK_DIR = join("mock-data", "external");

export function mockEnabled(override?: boolean): boolean {
  return override ?? serverConfig.externalApiMock;
}

const cache = new Map<string, unknown>();

export function loadMock<T>(name: string): T | null {
  if (cache.has(name)) return cache.get(name) as T | null;
  let value: T | null = null;
  try {
    const raw = readFileSync(join(process.cwd(), MOCK_DIR, `${name}.json`), "utf8");
    value = JSON.parse(raw) as T;
  } catch {
    value = null;
  }
  cache.set(name, value);
  return value;
}

/** テスト用：読み込んだファイルを忘れる */
export function resetMockCacheForTests(): void {
  cache.clear();
}

export interface MockTravelFile {
  legs?: Record<string, { durationSec: number; distanceM: number; walkM?: number | null }>;
}

export function mockLegKey(mode: TravelMode, fromKey: string, toKey: string): string {
  return `${mode}|${fromKey}|${toKey}`;
}

/** 記録済みの区間があればそれ（estimated=false）、無ければ概算（estimated=true） */
export function mockTravelLeg(
  from: LatLng & { key: string },
  to: LatLng & { key: string },
  mode: TravelMode,
): TravelLeg {
  const recorded = loadMock<MockTravelFile>("travel-matrix")?.legs?.[mockLegKey(mode, from.key, to.key)];
  if (recorded && Number.isFinite(recorded.durationSec) && Number.isFinite(recorded.distanceM)) {
    return {
      durationSec: Math.round(recorded.durationSec),
      distanceM: Math.round(recorded.distanceM),
      estimated: false,
      mode,
      walkM: recorded.walkM ?? (mode === "walking" ? Math.round(recorded.distanceM) : null),
    };
  }
  const est = estimateTravel(from, to, mode);
  return { ...est, estimated: true, mode, walkM: mode === "walking" ? est.distanceM : null };
}

export interface MockNominatimFile {
  search?: Record<string, PlaceCandidate[]>;
  reverse?: Record<string, PlaceCandidate | null>;
}

export function mockSearchPlaces(q: string): PlaceCandidate[] {
  const file = loadMock<MockNominatimFile>("nominatim");
  const hit = file?.search?.[q.trim()];
  return Array.isArray(hit) ? hit : [];
}

export function mockReverseGeocode(lat: number, lng: number): PlaceCandidate | null {
  const file = loadMock<MockNominatimFile>("nominatim");
  return file?.reverse?.[`${lat.toFixed(3)},${lng.toFixed(3)}`] ?? null;
}

/** 固定応答（検証前の JSON）。無ければ unclear の定型応答 */
export function mockGeminiResponse(): unknown {
  return (
    loadMock<unknown>("gemini") ?? {
      reply: "うまく読み取れませんでした。もう少し具体的に教えてください",
      conditions: {
        pace: "normal",
        interests: [],
        priority: "fewer_moves",
        timeWindows: [],
        orderHints: [],
        exclude: [],
      },
      unclear: true,
    }
  );
}
