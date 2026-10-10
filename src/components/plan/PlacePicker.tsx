"use client";

/**
 * 出発地・到着地の選択（F-5-1）：「現在地」または「スポット名で検索」。
 * 現在地は getCurrentPosition()、検索は GET /places/search（検索ボタン押下時のみ）。
 */
import { useId, useState, type FormEvent } from "react";
import { getCurrentPosition, geolocationErrorMessage } from "@/components/map/useGeolocation";
import {
  Badge,
  Button,
  Card,
  ChipGroup,
  EmptyState,
  ErrorMessage,
  FormField,
  Icon,
  Input,
  SuspendedNotice,
  cn,
} from "@/components/ui";
import { ApiClientError, api, errorMessage } from "@/lib/api/client";
import type { PlaceCandidate, PlacesSearchResponse, PlanPlace } from "@/lib/domain/types";

export type PlaceMode = "current" | "search";

const MODE_OPTIONS = [
  { value: "current", label: "現在地", icon: "locate-fixed" },
  { value: "search", label: "スポット名で検索", icon: "search" },
] as const;

export const CURRENT_LOCATION_LABEL = "現在地";

type SearchState =
  | { phase: "idle" }
  | { phase: "loading"; q: string }
  | { phase: "ready"; q: string; result: PlacesSearchResponse }
  | { phase: "suspended" }
  | { phase: "error"; message: string };

export interface PlacePickerProps {
  /** 見出し（「出発地」「到着地」） */
  label: string;
  value: PlanPlace | null;
  onChange: (place: PlanPlace | null) => void;
  error?: string;
  disabled?: boolean;
  /** 401 のときに呼ぶ（ログイン画面へ） */
  onUnauthorized?: () => void;
}

export function PlacePicker({ label, value, onChange, error, disabled, onUnauthorized }: PlacePickerProps) {
  const [mode, setMode] = useState<PlaceMode>("current");
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ phase: "idle" });
  const labelId = useId();

  async function locate() {
    setLocating(true);
    setLocateError(null);
    try {
      const pos = await getCurrentPosition();
      onChange({ lat: pos.lat, lng: pos.lng, label: CURRENT_LOCATION_LABEL });
    } catch (err) {
      setLocateError(geolocationErrorMessage(err));
    } finally {
      setLocating(false);
    }
  }

  async function runSearch(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearch({ phase: "loading", q });
    try {
      const result = await api.get<PlacesSearchResponse>(`/places/search?q=${encodeURIComponent(q)}`);
      setSearch({ phase: "ready", q, result });
    } catch (err) {
      if (err instanceof ApiClientError && err.isUnauthorized) {
        onUnauthorized?.();
        setSearch({ phase: "idle" });
        return;
      }
      if (err instanceof ApiClientError && err.isSuspended) {
        setSearch({ phase: "suspended" });
        return;
      }
      setSearch({ phase: "error", message: errorMessage(err, "検索に失敗しました") });
    }
  }

  function select(c: PlaceCandidate) {
    onChange({ lat: c.lat, lng: c.lng, label: c.name.slice(0, 100) });
  }

  const selectedLabel = value ? value.label || `${value.lat.toFixed(4)}, ${value.lng.toFixed(4)}` : null;

  return (
    <FormField label={label} asGroup error={error} htmlFor={labelId}>
      <div className="flex flex-col gap-3">
        <ChipGroup
          aria-labelledby={`${labelId}-label`}
          options={MODE_OPTIONS}
          value={mode}
          disabled={disabled}
          onChange={(v) => {
            if (v) setMode(v);
          }}
        />

        {value ? (
          <Card tone="primary" className="flex items-center gap-2 p-3" aria-live="polite">
            <Icon name="map-pin" size={20} className="text-primary-strong" />
            <span className="min-w-0 flex-1 truncate text-base text-text">{selectedLabel}</span>
            <Button variant="ghost" leftIcon="x" onClick={() => onChange(null)} disabled={disabled}>
              選び直す
            </Button>
          </Card>
        ) : null}

        {mode === "current" ? (
          <div className="flex flex-col gap-2">
            <Button
              variant="secondary"
              leftIcon="locate-fixed"
              loading={locating}
              disabled={disabled}
              onClick={() => void locate()}
              className="self-start"
            >
              現在地を取得
            </Button>
            {locateError ? (
              <ErrorMessage message={locateError} onRetry={() => void locate()} retrying={locating} />
            ) : null}
          </div>
        ) : (
          <form onSubmit={(e) => void runSearch(e)} className="flex flex-col gap-3">
            <div className="flex gap-2">
              <Input
                aria-label={`${label}を検索`}
                placeholder="例：京都駅"
                value={query}
                maxLength={100}
                disabled={disabled}
                onChange={(e) => setQuery(e.target.value)}
              />
              <Button
                type="submit"
                variant="secondary"
                leftIcon="search"
                loading={search.phase === "loading"}
                disabled={disabled || query.trim().length === 0}
              >
                検索
              </Button>
            </div>
            {search.phase === "suspended" ? (
              <SuspendedNotice feature="external_search" detail="登録済みのスポット名で検索してください。" />
            ) : null}
            {search.phase === "error" ? <ErrorMessage message={search.message} /> : null}
            {search.phase === "ready" ? (
              <SearchResult
                result={search.result}
                q={search.q}
                selected={value}
                onSelect={select}
                disabled={disabled}
              />
            ) : null}
          </form>
        )}
      </div>
    </FormField>
  );
}

interface SearchResultProps {
  result: PlacesSearchResponse;
  q: string;
  selected: PlanPlace | null;
  onSelect: (c: PlaceCandidate) => void;
  disabled?: boolean;
}

function SearchResult({ result, q, selected, onSelect, disabled }: SearchResultProps) {
  return (
    <div className="flex flex-col gap-3">
      {result.externalUnavailable ? (
        <p className="flex items-start gap-2 text-base text-text-muted">
          <Icon name="info" size={16} className="mt-1" />
          <span>外部の場所検索は利用できません。登録済みのスポットのみ表示しています。</span>
        </p>
      ) : null}
      {result.results.length === 0 ? (
        <EmptyState
          icon="search"
          title={`「${q}」に一致する場所が見つかりませんでした`}
          description="別の言葉で検索してください。"
        />
      ) : (
        <ul className="flex flex-col gap-2" aria-label="検索結果">
          {result.results.map((c) => {
            const isSelected = !!selected && selected.lat === c.lat && selected.lng === c.lng;
            return (
              <li key={`${c.source}:${c.id}`}>
                <button
                  type="button"
                  disabled={disabled}
                  aria-pressed={isSelected}
                  onClick={() => onSelect(c)}
                  className={cn(
                    "flex min-h-11 w-full items-center gap-3 rounded-card border px-3 py-2 text-left transition-colors",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50",
                    isSelected
                      ? "border-primary bg-primary-soft"
                      : "border-border bg-surface hover:bg-surface-muted",
                  )}
                >
                  <Icon name="map-pin" size={20} className="text-text-muted" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-base font-medium text-text">{c.name}</span>
                    {c.address || c.prefecture || c.city ? (
                      <span className="truncate text-base text-text-muted">
                        {c.address ?? [c.prefecture, c.city].filter(Boolean).join("")}
                      </span>
                    ) : null}
                  </span>
                  {c.source === "db" ? (
                    <Badge icon="map-pin" tone="muted">
                      登録済み
                    </Badge>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
