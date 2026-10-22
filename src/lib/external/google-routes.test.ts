import { describe, expect, it, vi } from "vitest";
import {
  computeRouteMatrix,
  departureTimeRfc3339,
  GOOGLE_ROUTES_FIELD_MASK,
  GOOGLE_ROUTES_MATRIX_URL,
} from "./google-routes";
import type { FetchLike } from "./notify";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const O = [{ lat: 36.578, lng: 136.6478 }];
const D = [
  { lat: 36.5621, lng: 136.6625 },
  { lat: 36.5725, lng: 136.6666 },
];

describe("departureTimeRfc3339", () => {
  it("日付＋開始時刻を日本時間の RFC3339 にする", () => {
    expect(departureTimeRfc3339("2026-11-03", "09:00")).toBe("2026-11-03T09:00:00+09:00");
  });
});

describe("computeRouteMatrix", () => {
  it("公式仕様どおりに POST し（キーはヘッダー、FieldMask 付き）、要素を返す", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse([
        {
          originIndex: 0,
          destinationIndex: 1,
          duration: "1320s",
          distanceMeters: 4200,
          condition: "ROUTE_EXISTS",
        },
        { destinationIndex: 0, duration: "900s", distanceMeters: 3000, condition: "ROUTE_EXISTS" },
        { originIndex: 0, destinationIndex: 2, condition: "ROUTE_NOT_FOUND" },
      ]),
    );
    const r = await computeRouteMatrix(O, D, "2026-11-03T09:00:00+09:00", { fetchImpl, apiKey: "test-key" });
    expect(r).toEqual([
      { originIndex: 0, destinationIndex: 1, durationSec: 1320, distanceM: 4200, condition: "ROUTE_EXISTS" },
      { originIndex: 0, destinationIndex: 0, durationSec: 900, distanceM: 3000, condition: "ROUTE_EXISTS" },
      {
        originIndex: 0,
        destinationIndex: 2,
        durationSec: null,
        distanceM: null,
        condition: "ROUTE_NOT_FOUND",
      },
    ]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(GOOGLE_ROUTES_MATRIX_URL);
    expect(url).not.toContain("test-key");
    const headers = init?.headers as Record<string, string>;
    expect(headers["X-Goog-Api-Key"]).toBe("test-key");
    expect(headers["X-Goog-FieldMask"]).toBe(GOOGLE_ROUTES_FIELD_MASK);
    expect(GOOGLE_ROUTES_FIELD_MASK).toBe("originIndex,destinationIndex,duration,distanceMeters,condition");
    const body = JSON.parse(String(init?.body));
    expect(body.travelMode).toBe("TRANSIT");
    expect(body.departureTime).toBe("2026-11-03T09:00:00+09:00");
    expect(body.origins[0]).toEqual({
      waypoint: { location: { latLng: { latitude: 36.578, longitude: 136.6478 } } },
    });
    expect(body.destinations).toHaveLength(2);
  });

  it("HTTP エラー・不正な応答・キー未設定は UPSTREAM_ERROR", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const err = vi.fn<FetchLike>(async () => jsonResponse({ error: {} }, 403));
    await expect(computeRouteMatrix(O, D, "t", { fetchImpl: err, apiKey: "k" })).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
    });
    const bad = vi.fn<FetchLike>(async () => jsonResponse({ not: "array" }));
    await expect(computeRouteMatrix(O, D, "t", { fetchImpl: bad, apiKey: "k" })).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
    });
    const none = vi.fn<FetchLike>();
    await expect(computeRouteMatrix(O, D, "t", { fetchImpl: none, apiKey: "" })).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
    });
    expect(none).not.toHaveBeenCalled();
  });
});
