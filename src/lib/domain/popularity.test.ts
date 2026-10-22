import { describe, expect, it } from "vitest";
import { POPULARITY_RANKING } from "./constants";
import { popularityForRank, rankPopularity, type PopularityInput } from "./popularity";

/** 同じ市区町村に postCounts の投稿数を持つスポットを作る */
function spotsOf(postCounts: number[], city = "金沢市", prefecture = "石川県"): PopularityInput[] {
  return postCounts.map((postCount, i) => ({ id: `${city}-${i + 1}`, prefecture, city, postCount }));
}

describe("rankPopularity", () => {
  it("12 件なら上位 2 件が大人気、上位 4 件までが人気（端数は切り上げ）", () => {
    const spots = spotsOf([30, 25, 20, 15, 10, 9, 8, 7, 6, 5, 4, 3]);
    const result = rankPopularity(spots);
    expect(result.get("金沢市-1")).toBe("very_popular");
    expect(result.get("金沢市-2")).toBe("very_popular");
    expect(result.get("金沢市-3")).toBe("popular");
    expect(result.get("金沢市-4")).toBe("popular");
    expect(result.get("金沢市-5")).toBe("normal");
    expect(result.get("金沢市-12")).toBe("normal");
    expect(result.size).toBe(12);
  });

  it("同じ投稿数は同じ人気度になる（境界をまたいでも同順位）", () => {
    // 10 件：上位 1 件が大人気。1 位が 2 件同数ならどちらも大人気
    const spots = spotsOf([20, 20, 10, 9, 8, 7, 6, 5, 4, 3]);
    const result = rankPopularity(spots);
    expect(result.get("金沢市-1")).toBe("very_popular");
    expect(result.get("金沢市-2")).toBe("very_popular");
    // 3 位（上位 30% = 3 件まで）は人気、4 位は通常
    expect(result.get("金沢市-3")).toBe("popular");
    expect(result.get("金沢市-4")).toBe("normal");
  });

  it("投稿が 2 件未満のスポットは順位にかかわらず通常", () => {
    const spots = spotsOf([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0]);
    const result = rankPopularity(spots);
    for (const s of spots) expect(result.get(s.id)).toBe("normal");
  });

  it("スポットが 10 件未満の市区町村は都道府県単位で順位付けする", () => {
    const kanazawa = spotsOf([25, 22, 20, 18, 15, 12, 10, 8, 6, 5, 4, 3, 2, 1], "金沢市");
    // 野々市市は 3 件なので都道府県（17 件）での順位を使う
    const nonoichi = spotsOf([21, 9, 1], "野々市市");
    const result = rankPopularity([...kanazawa, ...nonoichi]);
    // 金沢市は 14 件なので市内で順位付け：上位 2 件が大人気、上位 5 件までが人気
    expect(result.get("金沢市-1")).toBe("very_popular");
    expect(result.get("金沢市-2")).toBe("very_popular");
    expect(result.get("金沢市-3")).toBe("popular");
    expect(result.get("金沢市-5")).toBe("popular");
    expect(result.get("金沢市-6")).toBe("normal");
    // 野々市市は石川県 17 件（金沢市 14 ＋野々市市 3）の中での順位：上位 2 件が大人気、上位 6 件までが人気。
    // 21 件は県内 3 位 → 人気、9 件は 9 位 → 通常
    expect(result.get("野々市市-1")).toBe("popular");
    expect(result.get("野々市市-2")).toBe("normal");
    expect(result.get("野々市市-3")).toBe("normal");
  });

  it("都道府県が違うスポットは別々に順位付けする", () => {
    const ishikawa = spotsOf([5, 4, 3], "金沢市", "石川県");
    const kyoto = spotsOf([100, 2, 2], "京都市", "京都府");
    const result = rankPopularity([...ishikawa, ...kyoto]);
    expect(result.get("金沢市-1")).toBe("very_popular");
    expect(result.get("京都市-1")).toBe("very_popular");
    expect(result.get("京都市-2")).toBe("normal");
  });

  it("投稿 0 件のスポットは母数に含めず常に通常、都道府県・市区町村が null でも動く", () => {
    const spots: PopularityInput[] = [
      { id: "a", prefecture: null, city: null, postCount: 5 },
      { id: "b", prefecture: null, city: null, postCount: 0 },
      { id: "c", prefecture: null, city: null, postCount: 3 },
    ];
    const result = rankPopularity(spots);
    expect(result.get("a")).toBe("very_popular");
    expect(result.get("b")).toBe("normal");
    expect(result.get("c")).toBe("normal");
  });

  it("空の入力は空の Map を返す", () => {
    expect(rankPopularity([]).size).toBe(0);
  });
});

describe("popularityForRank", () => {
  it("定数どおりの境界で判定する", () => {
    const n = 20;
    const very = Math.ceil(n * POPULARITY_RANKING.veryPopularRatio);
    const pop = Math.ceil(n * POPULARITY_RANKING.popularRatio);
    expect(popularityForRank(very, n, 5)).toBe("very_popular");
    expect(popularityForRank(very + 1, n, 5)).toBe("popular");
    expect(popularityForRank(pop, n, 5)).toBe("popular");
    expect(popularityForRank(pop + 1, n, 5)).toBe("normal");
    expect(popularityForRank(1, n, POPULARITY_RANKING.minPostsForRank - 1)).toBe("normal");
  });
});
