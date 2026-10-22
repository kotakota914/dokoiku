/**
 * v0.3 F-1-5：人気度を市区町村内の投稿数の相対順位で決める純粋関数（POPULARITY_RANKING）。
 * - 単位は市区町村（prefecture + city）。市区町村内のスポットが minSpotsForCity（10）未満なら、
 *   その都道府県の全スポットをまとめた順位を使う。
 * - 投稿数の多い順に並べ、上位 veryPopularRatio（10%）＝大人気、上位 popularRatio（30%）まで＝人気、それ以外＝通常。
 *   端数は切り上げ（12 件なら上位 2 件が大人気、上位 4 件までが人気）。
 * - 同じ投稿数は同じ順位（同じ人気度）。投稿が minPostsForRank（2）未満のスポットは常に通常。
 * - 投稿が 0 件のスポットは地図に出ないので順位の母数に含めず、常に通常。
 * memory Repository と supabase の SQL 関数 recompute_popularity() は同じ規則で計算する。
 */
import { POPULARITY_RANKING, type Popularity } from "./constants";

export interface PopularityInput {
  id: string;
  prefecture: string | null;
  city: string | null;
  postCount: number;
}

interface Ranked {
  /** 母数（同じ単位のスポット数） */
  size: number;
  /** 1 始まりの順位。同数は同順位（自分より投稿が多いスポット数 + 1） */
  rank: number;
}

/** 投稿数の多い順の順位（同数は同順位）を id ごとに返す */
function rankWithin(spots: PopularityInput[]): Map<string, Ranked> {
  const sorted = [...spots].sort((a, b) => b.postCount - a.postCount);
  const out = new Map<string, Ranked>();
  let rank = 0;
  let prevCount: number | null = null;
  sorted.forEach((s, index) => {
    if (prevCount === null || s.postCount !== prevCount) {
      rank = index + 1;
      prevCount = s.postCount;
    }
    out.set(s.id, { size: sorted.length, rank });
  });
  return out;
}

/** 順位と母数から人気度を決める */
export function popularityForRank(rank: number, size: number, postCount: number): Popularity {
  if (postCount < POPULARITY_RANKING.minPostsForRank || size <= 0) return "normal";
  if (rank <= Math.ceil(size * POPULARITY_RANKING.veryPopularRatio)) return "very_popular";
  if (rank <= Math.ceil(size * POPULARITY_RANKING.popularRatio)) return "popular";
  return "normal";
}

/**
 * スポット一覧から人気度を計算する。戻り値は id → 人気度（入力の全件を含む）。
 * 入力は同じ都道府県に限らなくてよい（都道府県・市区町村ごとに内部で分ける）。
 */
export function rankPopularity(spots: PopularityInput[]): Map<string, Popularity> {
  const result = new Map<string, Popularity>();
  const byPrefecture = new Map<string, PopularityInput[]>();
  for (const s of spots) {
    if (s.postCount <= 0) {
      result.set(s.id, "normal");
      continue;
    }
    const pref = s.prefecture ?? "";
    const list = byPrefecture.get(pref) ?? [];
    list.push(s);
    byPrefecture.set(pref, list);
  }

  for (const prefSpots of byPrefecture.values()) {
    const byCity = new Map<string, PopularityInput[]>();
    for (const s of prefSpots) {
      const city = s.city ?? "";
      const list = byCity.get(city) ?? [];
      list.push(s);
      byCity.set(city, list);
    }
    // 都道府県単位の順位は、小さな市区町村のスポットが使う（必要になったときだけ計算）
    let prefRanks: Map<string, Ranked> | null = null;
    for (const citySpots of byCity.values()) {
      let ranks: Map<string, Ranked>;
      if (citySpots.length >= POPULARITY_RANKING.minSpotsForCity) {
        ranks = rankWithin(citySpots);
      } else {
        prefRanks ??= rankWithin(prefSpots);
        ranks = prefRanks;
      }
      for (const s of citySpots) {
        const r = ranks.get(s.id);
        result.set(s.id, r ? popularityForRank(r.rank, r.size, s.postCount) : "normal");
      }
    }
  }
  return result;
}
