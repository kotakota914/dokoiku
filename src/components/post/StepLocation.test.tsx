// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { NearbyResponse, PlacesSearchResponse } from "@/lib/domain/types";
import { GPS_FAILED_MESSAGE, GPS_INACCURATE_MESSAGE, StepLocation } from "./StepLocation";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const nearbySpot = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "近江町市場",
  lat: 36.5712,
  lng: 136.6572,
  category: "nature" as const,
  postCount: 3,
  likeCount: 1,
  popularity: "normal" as const,
  coverThumbUrl: null,
  prefecture: "石川県",
  city: "金沢市",
  distanceM: 24,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** fetch をパスごとに差し替える。呼ばれたパスは calls に残す */
function mockFetch(handlers: Record<string, (url: URL) => Response>) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      "http://localhost",
    );
    calls.push(url.pathname + url.search);
    const handler = handlers[url.pathname];
    if (!handler) return jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
    return handler(url);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

function mockGeolocation(result: { lat: number; lng: number; accuracy: number } | { denied: true }) {
  const getCurrentPosition = vi.fn((success: PositionCallback, error?: PositionErrorCallback) => {
    if ("denied" in result) {
      error?.({
        code: 1,
        message: "denied",
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      } as GeolocationPositionError);
      return;
    }
    success({
      coords: { latitude: result.lat, longitude: result.lng, accuracy: result.accuracy },
      timestamp: Date.now(),
    } as GeolocationPosition);
  });
  Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition }, configurable: true });
  return getCurrentPosition;
}

function renderStep(props: Partial<React.ComponentProps<typeof StepLocation>> = {}) {
  const onChange = vi.fn();
  render(<StepLocation value={null} onChange={onChange} onBack={() => {}} onNext={() => {}} {...props} />);
  return { onChange };
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("StepLocation（現在地から選ぶ）", () => {
  it("canCreate=false のときは誤差の文言を出し、新規登録ボタンを出さない（F-2 例外）", async () => {
    mockGeolocation({ lat: 36.5712, lng: 136.6572, accuracy: 150 });
    const { calls } = mockFetch({
      "/api/v1/spots/nearby": () =>
        jsonResponse({ canCreate: false, spots: [nearbySpot] } satisfies NearbyResponse),
    });
    renderStep();
    expect(await screen.findByText(GPS_INACCURATE_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新しいスポットとして登録" })).not.toBeInTheDocument();
    // 候補は選べる
    expect(screen.getByRole("button", { name: /近江町市場/ })).toBeInTheDocument();
    expect(calls[0]).toContain("/api/v1/spots/nearby?");
    expect(calls[0]).toContain("accuracy=150");
  });

  it("canCreate=true なら候補と新規登録ボタンを出し、名前を入れると newSpot を返す（F-2-6）", async () => {
    mockGeolocation({ lat: 36.5712, lng: 136.6572, accuracy: 12 });
    mockFetch({
      "/api/v1/spots/nearby": () =>
        jsonResponse({ canCreate: true, spots: [nearbySpot] } satisfies NearbyResponse),
    });
    const { onChange } = renderStep();
    const create = await screen.findByRole("button", { name: "新しいスポットとして登録" });
    expect(screen.queryByText(GPS_INACCURATE_MESSAGE)).not.toBeInTheDocument();
    fireEvent.click(create);
    fireEvent.change(screen.getByLabelText(/スポット名/), { target: { value: "新しい場所" } });
    expect(onChange).toHaveBeenLastCalledWith({
      newSpot: { name: "新しい場所", lat: 36.5712, lng: 136.6572, source: "gps", accuracyM: 12 },
    });
  });

  it("候補を押すと spotId を返す", async () => {
    mockGeolocation({ lat: 36.5712, lng: 136.6572, accuracy: 12 });
    mockFetch({
      "/api/v1/spots/nearby": () =>
        jsonResponse({ canCreate: true, spots: [nearbySpot] } satisfies NearbyResponse),
    });
    const { onChange } = renderStep();
    fireEvent.click(await screen.findByRole("button", { name: /近江町市場/ }));
    expect(onChange).toHaveBeenCalledWith({ spotId: nearbySpot.id, spotName: "近江町市場" });
  });

  it("位置情報が拒否されたら文言を出して検索タブへ切り替える（F-2 例外）", async () => {
    mockGeolocation({ denied: true });
    mockFetch({});
    renderStep();
    expect(await screen.findByText(GPS_FAILED_MESSAGE)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "スポット名で検索" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "検索" })).toBeInTheDocument();
  });

  it("場所が未選択のあいだ次へは無効", async () => {
    mockGeolocation({ lat: 36.5712, lng: 136.6572, accuracy: 12 });
    mockFetch({ "/api/v1/spots/nearby": () => jsonResponse({ canCreate: true, spots: [] }) });
    renderStep();
    await screen.findByText("近くに登録済みのスポットがありません");
    expect(screen.getByRole("button", { name: "次へ" })).toBeDisabled();
  });
});

describe("StepLocation（スポット名で検索）", () => {
  it("入力しただけでは呼ばず、検索ボタンで GET /places/search を呼ぶ（F-2-7）", async () => {
    const response: PlacesSearchResponse = {
      externalUnavailable: false,
      results: [
        {
          source: "db",
          id: nearbySpot.id,
          name: "近江町市場",
          lat: 36.5712,
          lng: 136.6572,
          address: null,
          prefecture: "石川県",
          city: "金沢市",
        },
        {
          source: "external",
          id: "osm:1",
          name: "近江町ふれあい館",
          lat: 36.5705,
          lng: 136.6565,
          address: "石川県金沢市",
          prefecture: "石川県",
          city: "金沢市",
        },
      ],
    };
    const { calls } = mockFetch({ "/api/v1/places/search": () => jsonResponse(response) });
    const { onChange } = renderStep({ initialTab: "search" });
    fireEvent.change(screen.getByLabelText("スポット名"), { target: { value: "近江町" } });
    expect(calls).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "検索" }));
    await screen.findByRole("button", { name: /近江町ふれあい館/ });
    expect(calls).toEqual(["/api/v1/places/search?q=%E8%BF%91%E6%B1%9F%E7%94%BA"]);

    fireEvent.click(screen.getByRole("button", { name: /近江町ふれあい館/ }));
    expect(onChange).toHaveBeenLastCalledWith({
      newSpot: {
        name: "近江町ふれあい館",
        lat: 36.5705,
        lng: 136.6565,
        source: "search_external",
        externalRef: "osm:1",
        address: "石川県金沢市",
        prefecture: "石川県",
        city: "金沢市",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /近江町市場/ }));
    expect(onChange).toHaveBeenLastCalledWith({ spotId: nearbySpot.id, spotName: "近江町市場" });
  });

  it("externalUnavailable のときは停止中の案内を出す", async () => {
    mockFetch({
      "/api/v1/places/search": () =>
        jsonResponse({ externalUnavailable: true, results: [] } satisfies PlacesSearchResponse),
    });
    renderStep({ initialTab: "search" });
    fireEvent.change(screen.getByLabelText("スポット名"), { target: { value: "どこか" } });
    fireEvent.click(screen.getByRole("button", { name: "検索" }));
    expect(await screen.findByText("現在、外部の場所検索は利用できません")).toBeInTheDocument();
  });

  it("401 なら onUnauthorized を呼ぶ", async () => {
    mockFetch({
      "/api/v1/places/search": () =>
        jsonResponse({ error: { code: "UNAUTHORIZED", message: "ログインが必要です" } }, 401),
    });
    const onUnauthorized = vi.fn();
    renderStep({ initialTab: "search", onUnauthorized });
    fireEvent.change(screen.getByLabelText("スポット名"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "検索" }));
    await waitFor(() => expect(onUnauthorized).toHaveBeenCalled());
  });
});
