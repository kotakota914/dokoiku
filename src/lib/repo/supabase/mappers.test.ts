import { describe, expect, it } from "vitest";
import {
  decodeSearchCursorValue,
  encodeSearchCursorValue,
  mapApiUsage,
  mapPlan,
  mapPlanSummary,
  mapPostView,
  mapSpot,
  mapSpotSummaryRow,
  mapTravelTime,
  mapWishlist,
  normalizeHistogram,
  parseEwkbPoint,
  quoteFilterValue,
  spotToDetail,
  toEwkt,
  toIso,
  type PlanRow,
  type PostJoinedRow,
  type SpotRow,
} from "./mappers";

const publicUrl = (path: string) =>
  `https://example.supabase.co/storage/v1/object/public/post-images/${path}`;

/** PostGIS が返す hex EWKB（SRID=4326, POINT(135.785 34.9949)）を組み立てる */
function ewkbPoint(lng: number, lat: number): string {
  const buf = Buffer.alloc(25);
  buf.writeUInt8(1, 0); // little endian
  buf.writeUInt32LE(0x20000001, 1); // Point + SRID フラグ
  buf.writeUInt32LE(4326, 5);
  buf.writeDoubleLE(lng, 9);
  buf.writeDoubleLE(lat, 17);
  return buf.toString("hex").toUpperCase();
}

describe("parseEwkbPoint", () => {
  it("SRID 付きの Point から lat / lng を取り出す", () => {
    const p = parseEwkbPoint(ewkbPoint(135.785, 34.9949));
    expect(p.lng).toBeCloseTo(135.785, 6);
    expect(p.lat).toBeCloseTo(34.9949, 6);
  });

  it("SRID なしの Point も読める", () => {
    const buf = Buffer.alloc(21);
    buf.writeUInt8(1, 0);
    buf.writeUInt32LE(1, 1);
    buf.writeDoubleLE(135.7727, 5);
    buf.writeDoubleLE(34.9671, 13);
    const p = parseEwkbPoint(buf.toString("hex"));
    expect(p.lng).toBeCloseTo(135.7727, 6);
    expect(p.lat).toBeCloseTo(34.9671, 6);
  });

  it("不正な文字列や Point 以外は例外にする", () => {
    expect(() => parseEwkbPoint("zz")).toThrow();
    const line = Buffer.alloc(25);
    line.writeUInt8(1, 0);
    line.writeUInt32LE(0x20000002, 1);
    expect(() => parseEwkbPoint(line.toString("hex"))).toThrow(/Point/);
  });

  it("toEwkt は SRID 付きの POINT(lng lat) を返す", () => {
    expect(toEwkt({ lat: 34.9949, lng: 135.785 })).toBe("SRID=4326;POINT(135.785 34.9949)");
  });
});

describe("mapSpot / spotToDetail", () => {
  const row: SpotRow = {
    id: "spot-1",
    name: "清水寺",
    location: ewkbPoint(135.785, 34.9949),
    address: "京都府京都市東山区",
    prefecture: "京都府",
    city: "京都市",
    category: "history",
    source: "search_db",
    external_ref: null,
    post_count: 7,
    like_count: 3,
    cover_image_id: "img-1",
    stay_minutes_median: 60,
    hour_histogram: [0, 1, 2],
    opening_hours: null,
    created_by: null,
    created_at: "2026-09-01T00:00:00+00:00",
  };

  it("snake_case の行を Spot に変換し、日時は +09:00 にそろえる", () => {
    const spot = mapSpot(row);
    expect(spot.lat).toBeCloseTo(34.9949, 6);
    expect(spot.lng).toBeCloseTo(135.785, 6);
    expect(spot.postCount).toBe(7);
    expect(spot.createdAt).toBe("2026-09-01T09:00:00.000+09:00");
    expect(spot.hourHistogram).toHaveLength(24);
    expect(spot.hourHistogram.slice(0, 3)).toEqual([0, 1, 2]);
  });

  it("詳細には代表写真の URL と人気度が付く", () => {
    const detail = spotToDetail(
      mapSpot(row),
      { full_path: "seed/kiyomizudera/1.webp", thumb_path: "seed/kiyomizudera/1_t.webp" },
      publicUrl,
    );
    expect(detail.popularity).toBe("popular");
    expect(detail.coverThumbUrl).toBe(publicUrl("seed/kiyomizudera/1_t.webp"));
    expect(detail.coverFullUrl).toBe(publicUrl("seed/kiyomizudera/1.webp"));
    expect(detail.address).toBe("京都府京都市東山区");
  });

  it("RPC の要約行は代表写真がなければ null", () => {
    const summary = mapSpotSummaryRow(
      {
        id: "s",
        name: "n",
        lat: 35,
        lng: 135,
        category: "nature",
        post_count: 25,
        like_count: 0,
        prefecture: null,
        city: null,
        cover_thumb_path: null,
      },
      publicUrl,
    );
    expect(summary.coverThumbUrl).toBeNull();
    expect(summary.popularity).toBe("very_popular");
  });
});

describe("mapPostView", () => {
  const row: PostJoinedRow = {
    id: "post-1",
    user_id: "user-1",
    spot_id: "spot-1",
    comment: "朝が静かでした",
    category: "history",
    stay_duration: "lt60",
    like_count: 2,
    status: "public",
    created_at: "2026-09-01T00:00:00+00:00",
    updated_at: "2026-09-02T00:00:00+00:00",
    post_images: [
      {
        id: "i2",
        post_id: "post-1",
        full_path: "posts/post-1/b.webp",
        thumb_path: "posts/post-1/b_t.webp",
        width: 1600,
        height: 1200,
        sort_order: 1,
      },
      {
        id: "i1",
        post_id: "post-1",
        full_path: "posts/post-1/a.webp",
        thumb_path: "posts/post-1/a_t.webp",
        width: 1600,
        height: 1200,
        sort_order: 0,
      },
    ],
    profiles: { id: "user-1", display_name: "太郎", avatar_url: null },
    spots: { name: "清水寺" },
  };

  it("画像を sort_order 順に並べ、作者・スポット名・likedByMe を付ける", () => {
    const view = mapPostView(row, publicUrl, true);
    expect(view.images.map((i) => i.id)).toEqual(["i1", "i2"]);
    expect(view.images[0].thumbUrl).toBe(publicUrl("posts/post-1/a_t.webp"));
    expect(view.author.displayName).toBe("太郎");
    expect(view.spotName).toBe("清水寺");
    expect(view.likedByMe).toBe(true);
    expect(view.updatedAt).toBe("2026-09-02T09:00:00.000+09:00");
  });

  it("作者が消えていても落ちない", () => {
    const view = mapPostView({ ...row, profiles: null, spots: null, post_images: null }, publicUrl, false);
    expect(view.author.id).toBe("user-1");
    expect(view.images).toEqual([]);
    expect(view.spotName).toBe("");
  });
});

describe("mapPlanSummary / mapApiUsage", () => {
  it("プランの訪問数は result.items の spot を数える", () => {
    const row: PlanRow = {
      id: "plan-1",
      wishlist_id: "list-1",
      user_id: "user-1",
      params: {
        listId: "list-1",
        spotIds: ["a", "b", "c"],
        origin: { lat: 34.98, lng: 135.75, label: "京都駅" },
        destination: null,
        date: "2026-11-03",
        startTime: "09:00",
        endTime: "18:00",
        mode: "walking",
        lunchBreak: true,
        method: "chat",
        preferences: {
          pace: "normal",
          interests: [],
          priority: "more_spots",
          timeWindows: [],
          orderHints: [],
          exclude: [],
        },
      },
      result: {
        id: "c2",
        kind: "most_spots",
        label: "回れる場所が最も多い案",
        reason: "",
        items: [
          {
            type: "spot",
            spotId: "a",
            arrive: "09:20",
            stayMin: 60,
            depart: "10:20",
            travelMinToNext: 15,
            next: { mode: "walking", travelMin: 15, estimated: false, walkM: 1100 },
            inBestTime: true,
          },
          {
            type: "lunch",
            arrive: "12:00",
            stayMin: 60,
            depart: "13:00",
            travelMinToNext: 10,
            next: { mode: "walking", travelMin: 10, estimated: false, walkM: 700 },
          },
          {
            type: "spot",
            spotId: "b",
            arrive: "13:10",
            stayMin: 45,
            depart: "13:55",
            travelMinToNext: null,
            next: null,
            inBestTime: false,
          },
        ],
        skipped: [{ spotId: "c", reason: "time_limit" }],
        notes: [],
        stats: { spotCount: 2, totalTravelMin: 25, walkM: 1800, endAt: "13:55", bestTimeHits: 1 },
        totalTravelMin: 25,
        endAt: "13:55",
        geometry: null,
        travelMatrixId: "tm",
        estimated: false,
      },
      total_travel_min: 25,
      method: "chat",
      created_at: "2026-09-01T00:00:00+00:00",
    };
    const summary = mapPlanSummary(row);
    expect(summary.spotCount).toBe(2);
    expect(summary.date).toBe("2026-11-03");
    expect(summary.totalTravelMin).toBe(25);
    expect(summary.method).toBe("chat");
    // v0.3 の形はそのまま返す
    const plan = mapPlan(row);
    expect(plan.params).toEqual(row.params);
    expect(plan.result).toEqual(row.result);
  });

  it("v0.1 で保存した行（method 列も候補の項目も無い）は既定値を補う", () => {
    const row = {
      id: "plan-old",
      wishlist_id: "list-1",
      user_id: "user-1",
      params: {
        listId: "list-1",
        spotIds: ["a"],
        origin: { lat: 34.98, lng: 135.75, label: "京都駅" },
        destination: null,
        date: "2026-11-03",
        startTime: "09:00",
        endTime: "18:00",
        mode: "driving",
        pace: "packed",
        interests: ["history"],
        lunchBreak: false,
      },
      result: {
        items: [
          {
            type: "spot",
            spotId: "a",
            arrive: "09:20",
            stayMin: 60,
            depart: "10:20",
            travelMinToNext: 15,
            inBestTime: true,
          },
        ],
        skipped: [],
        totalTravelMin: 15,
        endAt: "10:20",
        geometry: null,
        travelMatrixId: "tm",
        estimated: false,
      },
      total_travel_min: 15,
      created_at: "2026-09-01T00:00:00+00:00",
    } as unknown as PlanRow;
    expect(mapPlanSummary(row).method).toBe("auto");
    const plan = mapPlan(row);
    expect(plan.method).toBe("auto");
    expect(plan.params.method).toBe("auto");
    expect(plan.params.preferences).toMatchObject({
      pace: "packed",
      interests: ["history"],
      priority: "fewer_moves",
    });
    expect(plan.result.id).toBe("c1");
    expect(plan.result.kind).toBe("fewest_moves");
    expect(plan.result.stats).toEqual({
      spotCount: 1,
      totalTravelMin: 15,
      walkM: 0,
      endAt: "10:20",
      bestTimeHits: 1,
    });
    expect(plan.result.items[0].next).toEqual({
      mode: "driving",
      travelMin: 15,
      estimated: false,
      walkM: null,
    });
  });

  it("bigint が文字列で返っても数値にする", () => {
    const usage = mapApiUsage({
      provider: "ors",
      feature: "route_planning",
      period: "2026-10-10",
      count: "12",
      limit: "2000",
      suspended_at: null,
    });
    expect(usage.count).toBe(12);
    expect(usage.limit).toBe(2000);
    expect(usage.suspendedAt).toBeNull();
  });
});

describe("v0.3 の列", () => {
  it("mapWishlist は base_label / base_location（hex EWKB）を拠点にする。無ければ null", () => {
    const base = {
      id: "list-1",
      user_id: "user-1",
      name: "金沢旅行",
      share_token: null,
      created_at: "2026-09-01T00:00:00+00:00",
    };
    const withBase = mapWishlist(
      { ...base, base_label: "金沢駅", base_location: ewkbPoint(136.6478, 36.578) },
      3,
    );
    expect(withBase.baseLabel).toBe("金沢駅");
    expect(withBase.baseLocation?.lat).toBeCloseTo(36.578, 6);
    expect(withBase.baseLocation?.lng).toBeCloseTo(136.6478, 6);
    expect(withBase.itemCount).toBe(3);
    // 0003 適用前の行（列が無い）・壊れた値は拠点なし
    expect(mapWishlist(base, 0)).toMatchObject({ baseLabel: null, baseLocation: null });
    expect(mapWishlist({ ...base, base_label: "駅", base_location: "zz" }, 0)).toMatchObject({
      baseLabel: null,
      baseLocation: null,
    });
  });

  it("mapTravelTime は time_bucket が無ければ any", () => {
    const row = {
      from_key: "s:a",
      to_key: "s:b",
      mode: "transit" as const,
      duration_sec: 900,
      distance_m: 3000,
      fetched_at: "2026-09-01T00:00:00+00:00",
    };
    expect(mapTravelTime({ ...row, time_bucket: "weekday-09" }).timeBucket).toBe("weekday-09");
    expect(mapTravelTime(row).timeBucket).toBe("any");
  });

  it("人気度は spots.popularity（順位）を優先し、無いときだけ件数しきい値で代替する", () => {
    const row = {
      id: "s1",
      name: "兼六園",
      lat: 36.5619,
      lng: 136.6625,
      category: "nature" as const,
      post_count: 3,
      like_count: 1,
      prefecture: "石川県",
      city: "金沢市",
      cover_thumb_path: null,
    };
    expect(mapSpotSummaryRow({ ...row, popularity: "very_popular" }, publicUrl).popularity).toBe(
      "very_popular",
    );
    expect(mapSpotSummaryRow({ ...row, post_count: 30, popularity: "normal" }, publicUrl).popularity).toBe(
      "normal",
    );
    expect(mapSpotSummaryRow({ ...row, post_count: 30 }, publicUrl).popularity).toBe("very_popular");
  });
});

describe("小さなユーティリティ", () => {
  it("normalizeHistogram は 24 要素にそろえる", () => {
    expect(normalizeHistogram(null)).toHaveLength(24);
    expect(normalizeHistogram([5])).toEqual([5, ...new Array(23).fill(0)]);
  });

  it("toIso は解釈できない文字列をそのまま返す", () => {
    expect(toIso("not-a-date")).toBe("not-a-date");
  });

  it("検索カーソルの値は score と createdAt を往復できる", () => {
    const encoded = encodeSearchCursorValue(12, "2026-09-01T00:00:00+00:00");
    expect(decodeSearchCursorValue(encoded)).toEqual({ score: 12, createdAt: "2026-09-01T00:00:00+00:00" });
    expect(decodeSearchCursorValue("2026-09-01T00:00:00+00:00")).toEqual({
      score: null,
      createdAt: "2026-09-01T00:00:00+00:00",
    });
  });

  it("quoteFilterValue はダブルクォートとバックスラッシュをエスケープする", () => {
    expect(quoteFilterValue('a"b\\c')).toBe('"a\\"b\\\\c"');
  });
});
