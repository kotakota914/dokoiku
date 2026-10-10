import { describe, expect, it, vi } from "vitest";
import type { FetchLike } from "./notify";
import { fetchDirections, fetchMatrix } from "./ors";
import { estimateTravel, straightLine } from "./fallback";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const P = [
  { lat: 34.9858, lng: 135.7588 },
  { lat: 34.9948, lng: 135.785 },
];

describe("fetchMatrix", () => {
  it("公式仕様どおりに POST し、durations / distances を返す", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({
        durations: [
          [0, 1200],
          [1150, 0],
        ],
        distances: [
          [0, 1500],
          [1450, 0],
        ],
      }),
    );
    const r = await fetchMatrix(P, "walking", { fetchImpl, apiKey: "test-key" });
    expect(r.durations[0][1]).toBe(1200);
    expect(r.distances[1][0]).toBe(1450);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.openrouteservice.org/v2/matrix/foot-walking");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("test-key");
    const body = JSON.parse(String(init?.body));
    expect(body.locations).toEqual([
      [135.7588, 34.9858],
      [135.785, 34.9948],
    ]);
    expect(body.metrics).toEqual(["duration", "distance"]);
  });

  it("車は driving-car", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ durations: [[0]], distances: [[0]] }));
    await fetchMatrix([P[0], P[1]], "driving", { fetchImpl, apiKey: "k" });
    expect(fetchImpl.mock.calls[0][0]).toContain("/v2/matrix/driving-car");
  });

  it("HTTP エラーは UPSTREAM_ERROR", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ error: "rate limited" }, 429));
    await expect(fetchMatrix(P, "walking", { fetchImpl, apiKey: "k" })).rejects.toMatchObject({ code: "UPSTREAM_ERROR", status: 502 });
  });

  it("キー未設定は UPSTREAM_ERROR", async () => {
    const fetchImpl = vi.fn<FetchLike>();
    await expect(fetchMatrix(P, "walking", { fetchImpl, apiKey: "" })).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("fetchDirections", () => {
  it("geojson の LineString 座標を返す", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({
        type: "FeatureCollection",
        features: [{ type: "Feature", geometry: { type: "LineString", coordinates: [[135.7588, 34.9858], [135.77, 34.99], [135.785, 34.9948]] } }],
      }),
    );
    const coords = await fetchDirections(P, "walking", { fetchImpl, apiKey: "k" });
    expect(coords).toHaveLength(3);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.openrouteservice.org/v2/directions/foot-walking/geojson");
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body.coordinates).toEqual([
      [135.7588, 34.9858],
      [135.785, 34.9948],
    ]);
  });

  it("応答が不正なら UPSTREAM_ERROR", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ features: [] }));
    await expect(fetchDirections(P, "walking", { fetchImpl, apiKey: "k" })).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
  });
});

describe("fallback", () => {
  it("estimateTravel は直線距離 × 1.3 ÷ 速度", () => {
    const walk = estimateTravel(P[0], P[1], "walking");
    const drive = estimateTravel(P[0], P[1], "driving");
    expect(walk.distanceM).toBe(drive.distanceM);
    expect(walk.distanceM).toBeGreaterThan(3000);
    expect(walk.distanceM).toBeLessThan(4000);
    // 4.5km/h と 30km/h の比
    expect(walk.durationSec / drive.durationSec).toBeCloseTo(30 / 4.5, 1);
    expect(estimateTravel(P[0], P[0], "walking")).toEqual({ durationSec: 0, distanceM: 0 });
  });
  it("straightLine は [lng, lat] の LineString", () => {
    expect(straightLine(P)).toEqual({ type: "LineString", coordinates: [[135.7588, 34.9858], [135.785, 34.9948]] });
  });
});
