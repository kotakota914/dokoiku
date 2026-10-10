import { describe, expect, it } from "vitest";
import { mapModeForZoom } from "@/lib/domain/constants";
import { buildSpotsPath, zoomForRequest } from "./useViewportSpots";

const bbox = { minLng: 135.7, minLat: 34.9, maxLng: 135.8, maxLat: 35.0 };

describe("buildSpotsPath", () => {
  it("bbox と整数ズームを query にし、カテゴリがあれば category を付ける", () => {
    expect(buildSpotsPath({ bbox, zoom: 14 }, [])).toBe(
      "/spots?bbox=135.70000%2C34.90000%2C135.80000%2C35.00000&zoom=14",
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
