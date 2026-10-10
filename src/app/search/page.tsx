import type { Metadata } from "next";
import { LIMITS } from "@/lib/domain/constants";
import type { Page, SpotSummary } from "@/lib/domain/types";
import { getRepo } from "@/lib/repo";
import { spotSearchQuerySchema } from "@/lib/validation/schemas";
import { EMPTY_QUERY, SearchView, hasCondition, type SearchQuery } from "@/components/search/SearchView";

export const metadata: Metadata = { title: "スポットを検索" };

type SearchParams = Record<string, string | string[] | undefined>;
type Props = { searchParams: Promise<SearchParams> };

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** URL クエリを検索条件にする（不正な値は無視して空にする） */
function parseQuery(sp: SearchParams): SearchQuery {
  const parsed = spotSearchQuerySchema.safeParse({
    q: first(sp.q),
    prefecture: first(sp.prefecture),
    city: first(sp.city),
    category: first(sp.category),
    sort: first(sp.sort) ?? "popular",
  });
  if (!parsed.success) return { ...EMPTY_QUERY, q: first(sp.q)?.slice(0, 100) ?? "" };
  return {
    q: parsed.data.q ?? "",
    prefecture: parsed.data.prefecture ?? "",
    city: parsed.data.city ?? "",
    category: parsed.data.category ?? null,
    sort: parsed.data.sort,
  };
}

/** S-03 検索結果（F-3-6）。条件があれば初回結果をサーバーで取得する */
export default async function SearchPage({ searchParams }: Props) {
  const query = parseQuery(await searchParams);
  let initialResults: Page<SpotSummary> | null = null;
  let initialError: string | null = null;
  if (hasCondition(query)) {
    try {
      const repo = await getRepo();
      initialResults = await repo.spots.search({
        keyword: query.q || undefined,
        prefecture: query.prefecture || undefined,
        city: query.city || undefined,
        category: query.category ?? undefined,
        sort: query.sort,
        paging: { limit: LIMITS.postsPageSize },
      });
    } catch (err) {
      console.error("[search] 検索に失敗しました", err instanceof Error ? err.message : err);
      initialError = "検索に失敗しました。もう一度お試しください。";
    }
  }
  return <SearchView initialQuery={query} initialResults={initialResults} initialError={initialError} />;
}
