import { describe, expect, it } from "vitest";
import { JAPAN_CENTER, MAP_ZOOM } from "@/lib/domain/constants";
import {
  bboxOfPoints,
  bboxToQuery,
  expandBbox,
  formatHash,
  getInitialView,
  mapModeForZoom,
  parseHash,
} from "./view";

describe("getInitialView", () => {
  it("位置情報があれば現在地周辺（ズーム13）", () => {
    expect(getInitialView({ lat: 35.0116, lng: 135.7681 })).toEqual({
      center: { lat: 35.0116, lng: 135.7681 },
      zoom: MAP_ZOOM.initialWithLocation,
    });
  });
  it("位置情報がなければ日本全体（ズーム5）", () => {
    expect(getInitialView(null)).toEqual({
      center: { ...JAPAN_CENTER },
      zoom: MAP_ZOOM.initialWithoutLocation,
    });
    expect(getInitialView({ lat: Number.NaN, lng: 1 }).zoom).toBe(MAP_ZOOM.initialWithoutLocation);
  });
});

describe("parseHash / formatHash", () => {
  it("MapLibre 形式 #zoom/lat/lng を読む", () => {
    expect(parseHash("#13/35.0116/135.7681")).toEqual({ center: { lat: 35.0116, lng: 135.7681 }, zoom: 13 });
    expect(parseHash("13.5/35/135/30/45")).toEqual({ center: { lat: 35, lng: 135 }, zoom: 13.5 });
  });
  it("不正な形式は null", () => {
    expect(parseHash("")).toBeNull();
    expect(parseHash("#foo")).toBeNull();
    expect(parseHash("#13/35")).toBeNull();
    expect(parseHash("#13/95/135")).toBeNull();
    expect(parseHash("#abc/35/135")).toBeNull();
  });
  it("formatHash はズームに応じた桁で丸め、parseHash で読み戻せる", () => {
    const hash = formatHash({ center: { lat: 35.011623456, lng: 135.768123456 }, zoom: 13.123456 });
    // ズーム 13.12 では MapLibre と同じく小数5桁
    expect(hash).toBe("#13.12/35.01162/135.76812");
    expect(parseHash(hash)).toEqual({ center: { lat: 35.01162, lng: 135.76812 }, zoom: 13.12 });
    expect(formatHash({ center: JAPAN_CENTER, zoom: 5 })).toBe("#5/36.2/138.25");
  });
});

describe("bbox", () => {
  it("bboxOfPoints / expandBbox / bboxToQuery", () => {
    expect(bboxOfPoints([])).toBeNull();
    const b = bboxOfPoints([
      { lat: 35, lng: 135 },
      { lat: 36, lng: 134 },
    ]);
    expect(b).toEqual({ minLng: 134, minLat: 35, maxLng: 135, maxLat: 36 });
    expect(expandBbox(b!, 0.5)).toEqual({ minLng: 133.5, minLat: 34.5, maxLng: 135.5, maxLat: 36.5 });
    expect(bboxToQuery(b!)).toBe("134.00000,35.00000,135.00000,36.00000");
  });
});

describe("mapModeForZoom", () => {
  it("8/9・13/14 の境界で切り替わる（F-1-3）", () => {
    expect(mapModeForZoom(0)).toBe("heatmap");
    expect(mapModeForZoom(8)).toBe("heatmap");
    expect(mapModeForZoom(9)).toBe("cluster");
    expect(mapModeForZoom(13)).toBe("cluster");
    expect(mapModeForZoom(14)).toBe("pins");
    expect(mapModeForZoom(22)).toBe("pins");
  });
  it("小数のズームは GET /spots に送る整数（四捨五入）と同じ判定になる", () => {
    expect(mapModeForZoom(8.3)).toBe("heatmap");
    expect(mapModeForZoom(8.49)).toBe("heatmap");
    expect(mapModeForZoom(8.5)).toBe("cluster");
    expect(mapModeForZoom(8.9)).toBe("cluster");
    expect(mapModeForZoom(13.4)).toBe("cluster");
    expect(mapModeForZoom(13.5)).toBe("pins");
    expect(mapModeForZoom(13.9)).toBe("pins");
  });
});
