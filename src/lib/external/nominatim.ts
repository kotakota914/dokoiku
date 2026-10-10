/**
 * Nominatim（OpenStreetMap）の場所検索・逆ジオコーディング。サーバーからのみ呼ぶ。
 * 利用規約（https://operations.osmfoundation.org/policies/nominatim/）：
 * - 1 秒に 1 回まで → プロセス内で直列キューにし、前回の呼び出しから 1000ms 待つ
 * - 自動補完は禁止 → 画面は「検索」ボタン押下時だけ呼ぶ（F-2-7）
 * - 用途が分かる User-Agent を付ける（NOMINATIM_USER_AGENT）
 *
 * API 仕様（https://nominatim.org/release-docs/latest/api/Search/ , /api/Reverse/）
 * - GET https://nominatim.openstreetmap.org/search?format=jsonv2&q=...&countrycodes=jp&addressdetails=1&limit=10&accept-language=ja
 * - GET https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=...&lon=...&addressdetails=1&accept-language=ja
 * - jsonv2 の各要素：place_id, osm_type, osm_id, lat, lon, name, display_name, address{...}
 */
import { ApiError } from "@/lib/api/errors";
import { serverConfig } from "@/lib/config";
import type { PlaceCandidate } from "@/lib/domain/types";
import type { FetchLike } from "./notify";

export const NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org";
export const NOMINATIM_MIN_INTERVAL_MS = 1000;
export const NOMINATIM_DEFAULT_LIMIT = 10;

export interface NominatimAddress {
  state?: string;
  province?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  city_district?: string;
  ward?: string;
  suburb?: string;
  [key: string]: string | undefined;
}

export interface NominatimPlace {
  place_id?: number;
  osm_type?: string;
  osm_id?: number | string;
  lat: string;
  lon: string;
  name?: string;
  display_name?: string;
  address?: NominatimAddress;
  error?: string;
}

export interface NominatimOptions {
  fetchImpl?: FetchLike;
  limit?: number;
  /** 現在地があれば近い順に並べ替える参考にする（Nominatim は viewbox 無しでは距離順にしないため、こちらで並べ替える） */
  near?: { lat: number; lng: number };
  timeoutMs?: number;
}

// ---------- 1 秒 1 回の直列キュー ----------
let lastCallAt = 0;
let queue: Promise<unknown> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 直列化して前回から 1000ms 空ける。task は実際の HTTP 呼び出し */
export function throttled<T>(task: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const wait = lastCallAt + NOMINATIM_MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
    return task();
  };
  const p = queue.then(run, run);
  // 失敗しても次の呼び出しを止めない
  queue = p.catch(() => undefined);
  return p;
}

/** テスト用：キューと前回時刻を初期化する */
export function resetNominatimThrottleForTests(): void {
  lastCallAt = 0;
  queue = Promise.resolve();
}

// ---------- 住所の解析 ----------

/** 政令指定都市など「市＋区」を持つときは区まで含めて city にする */
export function parseJpAddress(address: NominatimAddress | undefined | null): { prefecture: string | null; city: string | null } {
  if (!address) return { prefecture: null, city: null };
  const prefecture = address.state ?? address.province ?? null;
  const base = address.city ?? address.town ?? address.village ?? address.municipality ?? null;
  const district = address.city_district ?? address.ward ?? null;
  let city: string | null = base;
  if (base && district && /市$/.test(base) && /区$/.test(district)) city = `${base}${district}`;
  // 東京 23 区などは city に「千代田区」が入る。市が無く区だけならそれを使う
  if (!city && district) city = district;
  return { prefecture, city };
}

export function toPlaceCandidate(p: NominatimPlace): PlaceCandidate | null {
  const lat = Number(p.lat);
  const lng = Number(p.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const { prefecture, city } = parseJpAddress(p.address);
  const displayName = p.display_name ?? "";
  const name = (p.name && p.name.trim()) || displayName.split(",")[0]?.trim() || "";
  if (!name) return null;
  const id = p.osm_type && p.osm_id !== undefined ? `${p.osm_type}:${p.osm_id}` : `place:${p.place_id ?? `${lat},${lng}`}`;
  return { source: "external", id, name, lat, lng, address: displayName || null, prefecture, city };
}

// ---------- HTTP ----------

async function getJson<T>(path: string, params: Record<string, string>, opts: NominatimOptions): Promise<T> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = new URL(`${NOMINATIM_BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  let res: Response;
  try {
    res = await fetchImpl(url.toString(), {
      method: "GET",
      headers: { "User-Agent": serverConfig.nominatimUserAgent, Accept: "application/json", "Accept-Language": "ja" },
      signal: controller.signal,
    });
  } catch (err) {
    console.error("[nominatim] request failed", err instanceof Error ? err.message : err);
    throw ApiError.upstream("場所検索サービスに接続できませんでした");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    console.error(`[nominatim] ${path} responded ${res.status}`);
    throw ApiError.upstream("場所検索サービスでエラーが発生しました");
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw ApiError.upstream("場所検索サービスの応答を読み取れませんでした");
  }
}

function distance2(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return (a.lat - b.lat) ** 2 + (a.lng - b.lng) ** 2;
}

/** 場所検索（日本国内、日本語）。1 秒 1 回のキューを通す */
export async function searchPlaces(q: string, opts: NominatimOptions = {}): Promise<PlaceCandidate[]> {
  const query = q.trim();
  if (!query) return [];
  const limit = String(Math.min(50, Math.max(1, opts.limit ?? NOMINATIM_DEFAULT_LIMIT)));
  const data = await throttled(() =>
    getJson<NominatimPlace[]>(
      "/search",
      { format: "jsonv2", q: query, countrycodes: "jp", addressdetails: "1", limit, "accept-language": "ja" },
      opts,
    ),
  );
  if (!Array.isArray(data)) return [];
  const results = data.map(toPlaceCandidate).filter((c): c is PlaceCandidate => c !== null);
  if (opts.near) {
    const near = opts.near;
    results.sort((a, b) => distance2(a, near) - distance2(b, near));
  }
  return results;
}

/** 逆ジオコーディング。該当なしは null */
export async function reverseGeocode(lat: number, lng: number, opts: NominatimOptions = {}): Promise<PlaceCandidate | null> {
  const data = await throttled(() =>
    getJson<NominatimPlace>(
      "/reverse",
      { format: "jsonv2", lat: String(lat), lon: String(lng), addressdetails: "1", "accept-language": "ja" },
      opts,
    ),
  );
  if (!data || data.error || typeof data.lat !== "string") return null;
  return toPlaceCandidate(data);
}
