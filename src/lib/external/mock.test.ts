import { afterEach, describe, expect, it } from "vitest";
import { coordKey, spotKey } from "@/lib/utils/geo";
import {
  loadMock,
  mockGeminiResponse,
  mockReverseGeocode,
  mockSearchPlaces,
  mockTravelLeg,
  resetMockCacheForTests,
} from "./mock";
import { reverseGeocode, searchPlaces } from "./nominatim";

afterEach(() => resetMockCacheForTests());

const STATION = { key: coordKey({ lat: 36.578, lng: 136.6478 }), lat: 36.578, lng: 136.6478 };
const KENROKUEN = { key: spotKey("b0000000-0000-4000-8000-000000000001"), lat: 36.5621, lng: 136.6625 };

describe("mock-data/external（F-8-8）", () => {
  it("記録済みのファイルを読める", () => {
    expect(loadMock("travel-matrix")).not.toBeNull();
    expect(loadMock("nominatim")).not.toBeNull();
    expect(loadMock("gemini")).not.toBeNull();
    expect(loadMock("no-such-file")).toBeNull();
  });

  it("記録済みの区間はそのまま、無い区間は概算", () => {
    const recorded = mockTravelLeg(STATION, KENROKUEN, "transit");
    expect(recorded).toMatchObject({ estimated: false, mode: "transit" });
    const other = mockTravelLeg(KENROKUEN, { key: "s:x", lat: 36.6, lng: 136.6 }, "transit");
    expect(other).toMatchObject({ estimated: true, mode: "transit" });
  });

  it("Nominatim は記録済みの結果を返し、fetch を呼ばない", async () => {
    expect(mockSearchPlaces("金沢駅").length).toBeGreaterThan(0);
    expect(mockSearchPlaces("記録の無い検索語")).toEqual([]);
    const results = await searchPlaces("金沢駅", {
      mock: true,
      fetchImpl: () => {
        throw new Error("fetch は呼ばない");
      },
    });
    expect(results[0]).toMatchObject({ source: "external", name: "金沢駅" });
    expect(await reverseGeocode(36.578, 136.648, { mock: true })).toEqual(
      mockReverseGeocode(36.578, 136.648),
    );
  });

  it("Gemini は固定応答", () => {
    expect(mockGeminiResponse()).toMatchObject({ reply: expect.any(String), conditions: expect.any(Object) });
  });
});
