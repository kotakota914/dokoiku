import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchLike } from "./notify";
import {
  NOMINATIM_MIN_INTERVAL_MS,
  parseJpAddress,
  resetNominatimThrottleForTests,
  reverseGeocode,
  searchPlaces,
  toPlaceCandidate,
  type NominatimPlace,
} from "./nominatim";

const KYOTO_STATION: NominatimPlace = {
  place_id: 1,
  osm_type: "way",
  osm_id: 123456,
  lat: "34.9858",
  lon: "135.7588",
  name: "京都駅",
  display_name: "京都駅, 下京区, 京都市, 京都府, 600-8216, 日本",
  address: { railway: "京都駅", city_district: "下京区", city: "京都市", state: "京都府", postcode: "600-8216", country: "日本", country_code: "jp" },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("parseJpAddress", () => {
  it("state を都道府県、city を市にする", () => {
    expect(parseJpAddress({ state: "奈良県", city: "奈良市" })).toEqual({ prefecture: "奈良県", city: "奈良市" });
  });
  it("政令指定都市は市＋区", () => {
    expect(parseJpAddress(KYOTO_STATION.address)).toEqual({ prefecture: "京都府", city: "京都市下京区" });
  });
  it("town / village も市区町村として扱う", () => {
    expect(parseJpAddress({ state: "京都府", town: "宇治田原町" })).toEqual({ prefecture: "京都府", city: "宇治田原町" });
    expect(parseJpAddress({ state: "奈良県", village: "十津川村" })).toEqual({ prefecture: "奈良県", city: "十津川村" });
  });
  it("東京 23 区は city に区が入る（市が無ければ区をそのまま使う）", () => {
    expect(parseJpAddress({ state: "東京都", city: "千代田区" })).toEqual({ prefecture: "東京都", city: "千代田区" });
    expect(parseJpAddress({ state: "東京都", city_district: "渋谷区" })).toEqual({ prefecture: "東京都", city: "渋谷区" });
  });
  it("無ければ null", () => {
    expect(parseJpAddress(undefined)).toEqual({ prefecture: null, city: null });
    expect(parseJpAddress({})).toEqual({ prefecture: null, city: null });
  });
});

describe("toPlaceCandidate", () => {
  it("osm_type:osm_id を id にした外部候補にする", () => {
    expect(toPlaceCandidate(KYOTO_STATION)).toEqual({
      source: "external",
      id: "way:123456",
      name: "京都駅",
      lat: 34.9858,
      lng: 135.7588,
      address: KYOTO_STATION.display_name,
      prefecture: "京都府",
      city: "京都市下京区",
    });
  });
  it("name が無ければ display_name の先頭を使い、座標が不正なら null", () => {
    expect(toPlaceCandidate({ ...KYOTO_STATION, name: undefined })?.name).toBe("京都駅");
    expect(toPlaceCandidate({ ...KYOTO_STATION, lat: "abc" })).toBeNull();
  });
});

describe("searchPlaces / reverseGeocode", () => {
  beforeEach(() => {
    resetNominatimThrottleForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-10T03:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("公式仕様どおりの URL と User-Agent で呼び、PlaceCandidate に変換する", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse([KYOTO_STATION]));
    const results = await searchPlaces("京都駅", { fetchImpl });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ source: "external", id: "way:123456", name: "京都駅", city: "京都市下京区" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://nominatim.openstreetmap.org/search");
    expect(u.searchParams.get("format")).toBe("jsonv2");
    expect(u.searchParams.get("q")).toBe("京都駅");
    expect(u.searchParams.get("countrycodes")).toBe("jp");
    expect(u.searchParams.get("addressdetails")).toBe("1");
    expect(u.searchParams.get("limit")).toBe("10");
    expect(u.searchParams.get("accept-language")).toBe("ja");
    const headers = init?.headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe("dokoiko-dev");
  });

  it("near を渡すと近い順に並べ替える", async () => {
    const far: NominatimPlace = { ...KYOTO_STATION, osm_id: 2, name: "遠い", lat: "35.5", lon: "136.5" };
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse([far, KYOTO_STATION]));
    const results = await searchPlaces("駅", { fetchImpl, near: { lat: 34.98, lng: 135.75 } });
    expect(results.map((r) => r.name)).toEqual(["京都駅", "遠い"]);
  });

  it("HTTP エラーは UPSTREAM_ERROR", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ error: "x" }, 503));
    await expect(searchPlaces("京都", { fetchImpl })).rejects.toMatchObject({ code: "UPSTREAM_ERROR", status: 502 });
  });

  it("2 回目の呼び出しは前回から 1000ms 待つ", async () => {
    const calledAt: number[] = [];
    const fetchImpl = vi.fn<FetchLike>(async () => {
      calledAt.push(Date.now());
      return jsonResponse([KYOTO_STATION]);
    });
    const p1 = searchPlaces("一回目", { fetchImpl });
    const p2 = searchPlaces("二回目", { fetchImpl });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(NOMINATIM_MIN_INTERVAL_MS - 1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await Promise.all([p1, p2]);
    expect(calledAt[1] - calledAt[0]).toBeGreaterThanOrEqual(NOMINATIM_MIN_INTERVAL_MS);
  });

  it("1 回目が失敗しても 2 回目は実行される", async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse([KYOTO_STATION]));
    const p1 = searchPlaces("失敗", { fetchImpl }).catch((e) => e);
    const p2 = searchPlaces("成功", { fetchImpl });
    await vi.advanceTimersByTimeAsync(NOMINATIM_MIN_INTERVAL_MS);
    const [e1, r2] = await Promise.all([p1, p2]);
    expect(e1).toMatchObject({ code: "UPSTREAM_ERROR" });
    expect(r2).toHaveLength(1);
  });

  it("reverseGeocode は /reverse を呼び、該当なしは null", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse(KYOTO_STATION));
    const r = await reverseGeocode(34.9858, 135.7588, { fetchImpl });
    expect(r?.name).toBe("京都駅");
    const u = new URL(fetchImpl.mock.calls[0][0]);
    expect(u.pathname).toBe("/reverse");
    expect(u.searchParams.get("lat")).toBe("34.9858");
    expect(u.searchParams.get("lon")).toBe("135.7588");
    expect(u.searchParams.get("format")).toBe("jsonv2");

    resetNominatimThrottleForTests();
    const none = vi.fn<FetchLike>(async () => jsonResponse({ error: "Unable to geocode" }));
    expect(await reverseGeocode(0, 0, { fetchImpl: none })).toBeNull();
  });
});
