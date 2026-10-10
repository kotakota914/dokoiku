/**
 * 検索条件（S-03）の型と純粋関数。Server Component（/search）と Client Component（SearchView）の両方から使う。
 * "use client" を付けないこと（サーバーから関数を呼ぶため）。
 */
import type { Category } from "@/lib/domain/constants";

export type SearchSort = "popular" | "newest";

/** 検索条件（URL クエリと同じ形） */
export interface SearchQuery {
  q: string;
  prefecture: string;
  city: string;
  category: Category | null;
  sort: SearchSort;
}

export const EMPTY_QUERY: SearchQuery = { q: "", prefecture: "", city: "", category: null, sort: "popular" };

/** 条件が 1 つでもあるか（並び順だけでは検索しない） */
export function hasCondition(q: SearchQuery): boolean {
  return Boolean(q.q.trim() || q.prefecture || q.city.trim() || q.category);
}

/** URL クエリ文字列（空の項目は省く） */
export function buildSearchParams(q: SearchQuery, cursor?: string | null): URLSearchParams {
  const params = new URLSearchParams();
  if (q.q.trim()) params.set("q", q.q.trim());
  if (q.prefecture) params.set("prefecture", q.prefecture);
  if (q.city.trim()) params.set("city", q.city.trim());
  if (q.category) params.set("category", q.category);
  params.set("sort", q.sort);
  if (cursor) params.set("cursor", cursor);
  return params;
}
