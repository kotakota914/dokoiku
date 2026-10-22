import { describe, expect, it } from "vitest";
import { mapModeForZoom } from "@/lib/domain/constants";
import { buildSpotsPath, zoomForRequest } from "./useViewportSpots";

const bbox = { minLng: 136.6, minLat: 36.5, maxLng: 136.7, maxLat: 36.6 };

describe("buildSpotsPath", () => {
  it("bbox と整数ズームを query にし、カテゴリがあれば category を付ける", () => {
    expect(buildSpotsPath({ bbox, zoom: 14 }, [])).toBe(
      "/spots?bbox=136.60000%2C36.50000%2C136.70000%2C36.60000&zoom=14",
    );
    expect(buildSpotsPath({ bbox, zoom: 14 }, ["gourmet", "nature"])).toContain("&category=gourmet%2Cnature");
  });

  it("小数のズームは四捨五入し、mapModeForZoom と同じ側に倒れる（F-1-3）", () => {
    for (const zoom of [8, 8.3, 8.49, 8.5, 8.9, 9, 13.4, 13.5, 13.9, 14]) {
      const sent = zoomForRequest(zoom);
      expect(buildSpotsPath({ bbox, zoom }, [])).toContain(`zoom=${sent}`);
      // サーバーは整数ズームで mode を決める。画面の判定（小数のまま）と一致すること
      expect(mapModeForZoom(zoom)).toBe(mapModeForZoom(sent));
    }
    expect(zoomForRequest(8.3)).toBe(8);
    expect(zoomForRequest(8.5)).toBe(9);
  });
});

describe("toResponse（v0.3 区画キャッシュの状態 → API と同じ形）", () => {
  it("spots / heatmap をそれぞれの形にする", async () => {
    const { toResponse } = await import("./useViewportSpots");
    expect(
      toResponse({ mode: "spots", spots: [], heatPoints: [], complete: true, z: 14, loading: false }),
    ).toEqual({ mode: "spots", spots: [] });
    expect(
      toResponse({
        mode: "heatmap",
        spots: [],
        heatPoints: [{ lat: 1, lng: 2, weight: 3 }],
        complete: false,
        z: 8,
        loading: true,
      }),
    ).toEqual({ mode: "heatmap", points: [{ lat: 1, lng: 2, weight: 3 }] });
  });
});
