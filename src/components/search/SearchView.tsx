"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api, errorMessage } from "@/lib/api/client";
import { CATEGORIES, CATEGORY_ICONS, CATEGORY_LABELS } from "@/lib/domain/constants";
import type { Page, SpotSummary } from "@/lib/domain/types";
import { spotSearchQuerySchema } from "@/lib/validation/schemas";
import { SpotMapLazy } from "@/components/map";
import {
  Button,
  Card,
  CategoryLabel,
  ChipGroup,
  EmptyState,
  ErrorMessage,
  FormField,
  Icon,
  Input,
  PhotoImage,
  PopularityBadge,
  Select,
  cn,
} from "@/components/ui";
import { PREFECTURE_OPTIONS } from "./prefectures";

import { EMPTY_QUERY, buildSearchParams, hasCondition, type SearchQuery, type SearchSort } from "./query";

export { EMPTY_QUERY, buildSearchParams, hasCondition };
export type { SearchQuery, SearchSort };

export interface SearchViewProps {
  initialQuery: SearchQuery;
  /** サーバーで取得した初回結果。条件が無ければ null */
  initialResults: Page<SpotSummary> | null;
  /** サーバー側の取得に失敗したときの文言 */
  initialError?: string | null;
}

const CATEGORY_OPTIONS = CATEGORIES.map((c) => ({
  value: c,
  label: CATEGORY_LABELS[c],
  icon: CATEGORY_ICONS[c],
}));
const SORT_OPTIONS: ReadonlyArray<{ value: SearchSort; label: string }> = [
  { value: "popular", label: "人気順" },
  { value: "newest", label: "新着順" },
];

/** S-03 検索結果：条件フォーム＋地図＋リスト（F-3-6） */
export function SearchView({ initialQuery, initialResults, initialError = null }: SearchViewProps) {
  const router = useRouter();
  const [form, setForm] = useState<SearchQuery>(initialQuery);
  const [applied, setApplied] = useState<SearchQuery | null>(
    hasCondition(initialQuery) ? initialQuery : null,
  );
  const [results, setResults] = useState<SpotSummary[]>(initialResults?.items ?? []);
  const [nextCursor, setNextCursor] = useState<string | null>(initialResults?.nextCursor ?? null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const requestSeq = useRef(0);

  const points = useMemo(() => results.map((s) => ({ lat: s.lat, lng: s.lng })), [results]);

  async function runSearch(query: SearchQuery) {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    setSelectedId(null);
    try {
      const page = await api.get<Page<SpotSummary>>(`/spots/search?${buildSearchParams(query).toString()}`);
      if (seq !== requestSeq.current) return;
      setResults(page.items);
      setNextCursor(page.nextCursor);
      setApplied(query);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(errorMessage(err, "検索に失敗しました"));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const parsed = spotSearchQuerySchema.safeParse({
      q: form.q || undefined,
      prefecture: form.prefecture || undefined,
      city: form.city || undefined,
      category: form.category ?? undefined,
      sort: form.sort,
    });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "検索条件が正しくありません");
      return;
    }
    if (!hasCondition(form)) {
      setFormError("キーワード・都道府県・市区町村・カテゴリのいずれかを入力してください");
      return;
    }
    setFormError(null);
    router.replace(`/search?${buildSearchParams(form).toString()}`, { scroll: false });
    void runSearch(form);
  }

  async function loadMore() {
    if (!applied || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await api.get<Page<SpotSummary>>(
        `/spots/search?${buildSearchParams(applied, nextCursor).toString()}`,
      );
      setResults((prev) => {
        const seen = new Set(prev.map((s) => s.id));
        return [...prev, ...page.items.filter((s) => !seen.has(s.id))];
      });
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(errorMessage(err, "続きの読み込みに失敗しました"));
    } finally {
      setLoadingMore(false);
    }
  }

  // 地図でピンを選んだらリストの該当カードまでスクロールする
  useEffect(() => {
    if (!selectedId) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-spot-id="${selectedId}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);

  const searched = applied !== null;

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-4 p-4 lg:p-6">
      <form
        onSubmit={submit}
        className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
        aria-label="検索条件"
      >
        <h1 className="text-lg font-semibold text-text">スポットを検索</h1>
        <FormField label="キーワード" hint="スポット名・住所">
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              type="search"
              value={form.q}
              onChange={(e) => setForm((f) => ({ ...f, q: e.target.value }))}
              placeholder="例：兼六園"
              maxLength={100}
              enterKeyHint="search"
            />
          )}
        </FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="都道府県">
            {({ id }) => (
              <Select
                id={id}
                value={form.prefecture}
                onChange={(e) => setForm((f) => ({ ...f, prefecture: e.target.value }))}
                options={PREFECTURE_OPTIONS}
              >
                <option value="">指定しない</option>
              </Select>
            )}
          </FormField>
          <FormField label="市区町村">
            {({ id }) => (
              <Input
                id={id}
                value={form.city}
                onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                placeholder="例：金沢市"
                maxLength={30}
              />
            )}
          </FormField>
        </div>
        <FormField label="カテゴリ" asGroup>
          {({ id }) => (
            <ChipGroup
              aria-labelledby={`${id}-label`}
              options={CATEGORY_OPTIONS}
              value={form.category}
              onChange={(v) => setForm((f) => ({ ...f, category: v }))}
              allowDeselect
            />
          )}
        </FormField>
        <FormField label="並び順" asGroup>
          {({ id }) => (
            <ChipGroup
              aria-labelledby={`${id}-label`}
              options={SORT_OPTIONS}
              value={form.sort}
              onChange={(v) => setForm((f) => ({ ...f, sort: v ?? "popular" }))}
            />
          )}
        </FormField>
        {formError ? (
          <p role="alert" className="flex items-start gap-1 text-base text-danger">
            <Icon name="circle-alert" size={16} className="mt-1" />
            <span>{formError}</span>
          </p>
        ) : null}
        <Button type="submit" leftIcon="search" loading={loading} fullWidth className="sm:w-auto sm:self-end">
          検索
        </Button>
      </form>

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <section aria-label="検索結果" className="flex flex-col gap-3 lg:order-1">
          {error ? (
            <ErrorMessage
              message={error}
              onRetry={() => (applied ? void runSearch(applied) : submit())}
              retrying={loading}
            />
          ) : null}
          {!searched && !loading ? (
            <EmptyState
              icon="search"
              title="条件を入力して検索してください"
              description="キーワード、都道府県、市区町村、カテゴリで絞り込めます。"
            />
          ) : null}
          {searched && !loading && !error && results.length === 0 ? (
            <EmptyState
              icon="search"
              title="該当するスポットがありません"
              description="条件を変えて検索してください"
            />
          ) : null}
          {results.length > 0 ? (
            <>
              <p className="text-base text-text-muted" aria-live="polite">
                {results.length} 件{nextCursor ? "以上" : ""}
              </p>
              <ul ref={listRef} className="flex flex-col gap-3">
                {results.map((spot) => (
                  <li key={spot.id} data-spot-id={spot.id}>
                    <SpotResultCard
                      spot={spot}
                      selected={spot.id === selectedId}
                      onSelect={() => setSelectedId(spot.id)}
                    />
                  </li>
                ))}
              </ul>
              {nextCursor ? (
                <Button variant="secondary" onClick={() => void loadMore()} loading={loadingMore} fullWidth>
                  さらに読み込む
                </Button>
              ) : null}
            </>
          ) : null}
        </section>

        <section
          aria-label="検索結果の地図"
          className="order-first lg:order-2 lg:sticky lg:top-[calc(var(--header-height)+1.5rem)]"
        >
          <div className="h-64 overflow-hidden rounded-card border border-border sm:h-80 lg:h-[calc(100vh-var(--header-height)-3rem)]">
            <SpotMapLazy
              className="h-full w-full"
              spots={results}
              fitTo={points.length > 0 ? points : null}
              selectedSpotId={selectedId}
              onSpotTap={(spot) => setSelectedId(spot.id)}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

interface SpotResultCardProps {
  spot: SpotSummary;
  selected: boolean;
  onSelect: () => void;
}

/**
 * 結果リストの 1 件：サムネイル・名前・住所・投稿数・人気度・詳細リンク。
 * カードのクリックで地図のピンを選べるが、キーボード・スクリーンリーダー向けに「地図で表示」ボタンも置く。
 */
function SpotResultCard({ spot, selected, onSelect }: SpotResultCardProps) {
  const address = [spot.prefecture, spot.city].filter(Boolean).join("");
  return (
    <Card
      as="article"
      tone={selected ? "primary" : "default"}
      flush
      className={cn("flex gap-3 p-3", selected && "border-primary")}
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
    >
      <PhotoImage
        src={spot.coverThumbUrl}
        alt={`${spot.name}の写真`}
        category={spot.category}
        className="size-24 shrink-0 rounded-card border border-border"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h2 className="truncate text-base font-semibold text-text">{spot.name}</h2>
        {address ? (
          <p className="flex items-center gap-1 truncate text-base text-text-muted">
            <Icon name="map-pin" size={16} />
            <span className="truncate">{address}</span>
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-base text-text-muted">
          <CategoryLabel category={spot.category} />
          <span className="inline-flex items-center gap-1">
            <Icon name="camera" size={16} />
            投稿 {spot.postCount} 件
          </span>
          <PopularityBadge popularity={spot.popularity} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link
            href={`/spots/${spot.id}`}
            className="inline-flex min-h-11 items-center gap-1 text-base font-medium text-primary-strong hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            詳細を見る
            <Icon name="chevron-right" size={16} />
          </Link>
          <button
            type="button"
            aria-pressed={selected}
            aria-label={`${spot.name}を地図で表示`}
            onClick={(e) => {
              e.stopPropagation();
              onSelect();
            }}
            className="inline-flex min-h-11 items-center gap-1 rounded-card text-base text-text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <Icon name="map-pin" size={16} />
            地図で表示
          </button>
        </div>
      </div>
    </Card>
  );
}
