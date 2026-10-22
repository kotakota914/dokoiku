/**
 * 経路画面（S-09〜S-12）のテスト用データ。テストからだけ import する。
 */
import type {
  PlanCandidate,
  PlanComputeResponse,
  PlanParams,
  PlanResult,
  SpotSummary,
  SystemStatus,
  WishlistDetail,
  WishlistItem,
} from "@/lib/domain/types";

export const LIST_ID = "11111111-1111-4111-8111-111111111111";
export const S1 = "22222222-2222-4222-8222-222222222221";
export const S2 = "22222222-2222-4222-8222-222222222222";
export const S3 = "22222222-2222-4222-8222-222222222223";

export function spotId(n: number): string {
  return `33333333-3333-4333-8333-${n.toString(16).padStart(12, "0")}`;
}

function spot(
  id: string,
  name: string,
  lat: number,
  lng: number,
  category: SpotSummary["category"],
): SpotSummary {
  return {
    id,
    name,
    lat,
    lng,
    category,
    postCount: 1,
    likeCount: 0,
    popularity: "normal",
    coverThumbUrl: null,
    prefecture: "石川県",
    city: "金沢市",
  };
}

export const spots: SpotSummary[] = [
  spot(S1, "兼六園", 36.5619, 136.6625, "history"),
  spot(S2, "金沢城公園", 36.5649, 136.659, "history"),
  spot(S3, "ひがし茶屋街", 36.5725, 136.6672, "photogenic"),
];

export const params: PlanParams = {
  listId: LIST_ID,
  spotIds: [S1, S2, S3],
  origin: { lat: 36.578, lng: 136.6478, label: "金沢駅" },
  destination: null,
  date: "2026-11-03",
  startTime: "09:00",
  endTime: "18:00",
  mode: "walking",
  lunchBreak: true,
  method: "auto",
  preferences: {
    pace: "normal",
    interests: [],
    priority: "fewer_moves",
    timeWindows: [],
    orderHints: [],
    exclude: [],
  },
};

export const candidateA: PlanCandidate = {
  id: "c1",
  kind: "fewest_moves",
  label: "移動が最も少ない案",
  reason: "近い場所どうしをまとめ、移動を合計45分に抑えました",
  items: [
    {
      type: "spot",
      spotId: S1,
      arrive: "09:25",
      stayMin: 60,
      depart: "10:25",
      travelMinToNext: 18,
      next: { mode: "walking", travelMin: 18, estimated: false, walkM: 1300 },
      inBestTime: true,
    },
    {
      type: "spot",
      spotId: S2,
      arrive: "10:43",
      stayMin: 45,
      depart: "11:28",
      travelMinToNext: 2,
      next: { mode: "walking", travelMin: 2, estimated: false, walkM: 100 },
      inBestTime: false,
    },
    { type: "lunch", arrive: "11:30", stayMin: 60, depart: "12:30", travelMinToNext: null, next: null },
  ],
  skipped: [{ spotId: S3, reason: "time_limit" }],
  notes: [],
  stats: { spotCount: 2, totalTravelMin: 45, walkM: 2800, endAt: "12:30", bestTimeHits: 1 },
  geometry: null,
};

export const candidateB: PlanCandidate = {
  id: "c2",
  kind: "most_spots",
  label: "回れる場所が最も多い案",
  reason: "3か所すべてを回れる順番です",
  items: [
    {
      type: "spot",
      spotId: S3,
      arrive: "09:30",
      stayMin: 30,
      depart: "10:00",
      travelMinToNext: 20,
      next: { mode: "walking", travelMin: 20, estimated: true, walkM: 1500 },
      inBestTime: false,
    },
    {
      type: "spot",
      spotId: S1,
      arrive: "10:20",
      stayMin: 60,
      depart: "11:20",
      travelMinToNext: 5,
      next: { mode: "walking", travelMin: 5, estimated: true, walkM: 400 },
      inBestTime: true,
    },
    {
      type: "spot",
      spotId: S2,
      arrive: "11:25",
      stayMin: 45,
      depart: "12:10",
      travelMinToNext: null,
      next: null,
      inBestTime: false,
    },
  ],
  skipped: [],
  notes: ["移動時間は直線距離からの概算です"],
  stats: { spotCount: 3, totalTravelMin: 55, walkM: 4200, endAt: "12:10", bestTimeHits: 1 },
  geometry: null,
};

export const computeResponse: PlanComputeResponse = {
  candidates: [candidateA, candidateB],
  travelMatrixId: "tm_test",
};

export function asResult(c: PlanCandidate, overrides: Partial<PlanResult> = {}): PlanResult {
  return {
    ...c,
    totalTravelMin: c.stats.totalTravelMin,
    endAt: c.stats.endAt,
    travelMatrixId: "tm_test",
    estimated: false,
    ...overrides,
  };
}

export function wishlistItem(
  id: string,
  name: string,
  opts: { mustVisit?: boolean; createdAt?: string; deleted?: boolean } = {},
): WishlistItem {
  return {
    spotId: id,
    mustVisit: opts.mustVisit ?? false,
    createdAt: opts.createdAt ?? "2026-10-01T09:00:00+09:00",
    spot: opts.deleted ? null : spot(id, name, 36.56, 136.65, "history"),
  };
}

export function wishlist(items: WishlistItem[], base = true): WishlistDetail {
  return {
    id: LIST_ID,
    userId: "u1",
    name: "金沢",
    baseLabel: base ? "金沢駅" : null,
    baseLocation: base ? { lat: 36.578, lng: 136.6478 } : null,
    shareToken: null,
    createdAt: "2026-10-01T09:00:00+09:00",
    itemCount: items.length,
    items,
    plans: [],
  };
}

export function systemStatus(
  overrides: Partial<SystemStatus["capabilities"]> = {},
  suspended: SystemStatus["suspended"] = [],
): SystemStatus {
  return {
    suspended,
    capabilities: {
      externalSearch: false,
      routing: true,
      transit: true,
      ai: true,
      googleLogin: false,
      backend: "memory",
      ...overrides,
    },
  };
}

export function suspendedFeature(feature: SystemStatus["suspended"][number]["feature"]) {
  return {
    feature,
    provider: "test",
    period: "2026-10",
    count: 1,
    limit: 1,
    suspendedAt: "2026-10-22T00:00:00+09:00",
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export function urlOf(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}
