"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  Badge,
  Button,
  Card,
  CategoryLabel,
  EmptyState,
  ErrorMessage,
  FormField,
  Icon,
  Input,
  LoadingState,
  PhotoImage,
  SuspendedNotice,
  cn,
} from "@/components/ui";
import { getCurrentPosition, geolocationErrorMessage } from "@/components/map/useGeolocation";
import type { CurrentLocation } from "@/components/map/MapContext";
import { ApiClientError, api, errorMessage } from "@/lib/api/client";
import { LIMITS } from "@/lib/domain/constants";
import type { NearbyResponse, NearbySpot, PlaceCandidate, PlacesSearchResponse } from "@/lib/domain/types";
import { newSpotInputSchema } from "@/lib/validation/schemas";
import { WizardFooter } from "./WizardFooter";
import type { LocationChoice } from "./types";

export type LocationTab = "gps" | "search";

export interface StepLocationProps {
  value: LocationChoice | null;
  onChange: (choice: LocationChoice | null) => void;
  onBack: () => void;
  onNext: () => void;
  /** 401 のとき（ログイン画面へ） */
  onUnauthorized?: () => void;
  /** 最初に開くタブ */
  initialTab?: LocationTab;
}

export const GPS_FAILED_MESSAGE = "現在地を取得できませんでした。スポット名で検索してください";
export const GPS_INACCURATE_MESSAGE = "位置の誤差が大きいため、候補から選んでください";

type GpsState =
  | { phase: "idle" }
  | { phase: "locating" }
  | { phase: "loading"; position: CurrentLocation }
  | { phase: "ready"; position: CurrentLocation; nearby: NearbyResponse }
  | { phase: "error"; message: string; retry: "locate" | "fetch"; position?: CurrentLocation };

type SearchState =
  | { phase: "idle" }
  | { phase: "loading"; q: string }
  | { phase: "ready"; q: string; result: PlacesSearchResponse }
  | { phase: "error"; q: string; message: string };

function formatDistance(m: number): string {
  if (m < 1000) return `約${Math.round(m)}m`;
  return `約${(m / 1000).toFixed(1)}km`;
}

function nearbyPath(p: CurrentLocation): string {
  const params = new URLSearchParams({
    lat: String(p.lat),
    lng: String(p.lng),
    accuracy: String(Math.round(p.accuracyM)),
  });
  return `/spots/nearby?${params.toString()}`;
}

/** ステップ 2：場所（F-2-5〜F-2-7） */
export function StepLocation({
  value,
  onChange,
  onBack,
  onNext,
  onUnauthorized,
  initialTab = "gps",
}: StepLocationProps) {
  const [tab, setTab] = useState<LocationTab>(initialTab);
  const [gps, setGps] = useState<GpsState>({ phase: "idle" });
  const [gpsNotice, setGpsNotice] = useState<string | null>(null);
  const [newSpotName, setNewSpotName] = useState(value?.newSpot?.source === "gps" ? value.newSpot.name : "");
  const [creatingNew, setCreatingNew] = useState(value?.newSpot?.source === "gps");
  const [search, setSearch] = useState<SearchState>({ phase: "idle" });
  const [query, setQuery] = useState("");
  const started = useRef(false);

  const handleApiError = useCallback(
    (err: unknown, fallback: string): string => {
      if (err instanceof ApiClientError && err.isUnauthorized) onUnauthorized?.();
      return errorMessage(err, fallback);
    },
    [onUnauthorized],
  );

  const fetchNearby = useCallback(
    async (position: CurrentLocation) => {
      setGps({ phase: "loading", position });
      try {
        const nearby = await api.get<NearbyResponse>(nearbyPath(position));
        setGps({ phase: "ready", position, nearby });
      } catch (err) {
        setGps({
          phase: "error",
          position,
          retry: "fetch",
          message: handleApiError(err, "近くのスポットを取得できませんでした"),
        });
      }
    },
    [handleApiError],
  );

  const locate = useCallback(async () => {
    setGps({ phase: "locating" });
    setGpsNotice(null);
    let position: CurrentLocation;
    try {
      position = await getCurrentPosition();
    } catch (err) {
      // 例外：拒否・失敗時は文言を出して検索タブへ切り替える
      setGps({ phase: "error", retry: "locate", message: geolocationErrorMessage(err) });
      setGpsNotice(GPS_FAILED_MESSAGE);
      setTab("search");
      return;
    }
    await fetchNearby(position);
  }, [fetchNearby]);

  // GPS タブを最初に開いたとき自動で取得する
  useEffect(() => {
    if (tab !== "gps" || started.current) return;
    started.current = true;
    void locate();
  }, [tab, locate]);

  function selectExisting(spot: { id: string; name: string }) {
    setCreatingNew(false);
    onChange({ spotId: spot.id, spotName: spot.name });
  }

  function startNewSpot(position: CurrentLocation) {
    setCreatingNew(true);
    const name = newSpotName.trim();
    onChange(
      name.length > 0
        ? {
            newSpot: {
              name,
              lat: position.lat,
              lng: position.lng,
              source: "gps",
              accuracyM: position.accuracyM,
            },
          }
        : null,
    );
  }

  function updateNewSpotName(name: string, position: CurrentLocation) {
    setNewSpotName(name);
    const parsed = newSpotInputSchema.shape.name.safeParse(name);
    onChange(
      parsed.success
        ? {
            newSpot: {
              name: parsed.data,
              lat: position.lat,
              lng: position.lng,
              source: "gps",
              accuracyM: position.accuracyM,
            },
          }
        : null,
    );
  }

  function selectCandidate(c: PlaceCandidate) {
    setCreatingNew(false);
    if (c.source === "db") {
      onChange({ spotId: c.id, spotName: c.name });
      return;
    }
    onChange({
      newSpot: {
        name: c.name.slice(0, LIMITS.spotNameMax),
        lat: c.lat,
        lng: c.lng,
        source: "search_external",
        externalRef: c.id,
        ...(c.address ? { address: c.address } : {}),
        ...(c.prefecture ? { prefecture: c.prefecture } : {}),
        ...(c.city ? { city: c.city } : {}),
      },
    });
  }

  async function runSearch(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setSearch({ phase: "loading", q: trimmed });
    try {
      const result = await api.get<PlacesSearchResponse>(`/places/search?q=${encodeURIComponent(trimmed)}`);
      setSearch({ phase: "ready", q: trimmed, result });
    } catch (err) {
      setSearch({ phase: "error", q: trimmed, message: handleApiError(err, "検索に失敗しました") });
    }
  }

  function submitSearch(e: FormEvent) {
    e.preventDefault();
    void runSearch(query);
  }

  const newSpotNameError =
    creatingNew && newSpotName.length > 0 && !newSpotInputSchema.shape.name.safeParse(newSpotName).success
      ? `スポット名は${LIMITS.spotNameMin}〜${LIMITS.spotNameMax}文字で入力してください`
      : undefined;

  const selectedKey = value
    ? value.newSpot
      ? `new:${value.newSpot.externalRef ?? "gps"}`
      : `spot:${value.spotId}`
    : null;

  const tabClass = (active: boolean) =>
    cn(
      "flex min-h-11 flex-1 items-center justify-center gap-2 rounded-card border px-3 text-base font-medium transition-colors",
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
      active
        ? "border-primary bg-primary text-on-primary"
        : "border-border bg-surface text-text hover:bg-surface-muted",
    );

  return (
    <div className="flex flex-col gap-4">
      {value ? (
        <Card tone="primary" className="flex items-start gap-2" aria-live="polite">
          <Icon name="map-pin" size={20} className="mt-0.5 text-primary-strong" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="text-base text-text-muted">選択中の場所</p>
            <p className="break-words text-base font-medium text-text">
              {value.newSpot ? value.newSpot.name : value.spotName}
            </p>
            {value.newSpot ? (
              <Badge icon="plus" tone="primary" className="self-start">
                新しいスポット
              </Badge>
            ) : null}
          </div>
        </Card>
      ) : null}

      <div role="tablist" aria-label="場所の指定方法" className="flex gap-2">
        <button
          type="button"
          role="tab"
          id="location-tab-gps"
          aria-selected={tab === "gps"}
          aria-controls="location-panel-gps"
          className={tabClass(tab === "gps")}
          onClick={() => setTab("gps")}
        >
          <Icon name="locate-fixed" size={20} />
          現在地から選ぶ
        </button>
        <button
          type="button"
          role="tab"
          id="location-tab-search"
          aria-selected={tab === "search"}
          aria-controls="location-panel-search"
          className={tabClass(tab === "search")}
          onClick={() => setTab("search")}
        >
          <Icon name="search" size={20} />
          スポット名で検索
        </button>
      </div>

      {gpsNotice ? (
        <Card tone="warning" role="status" className="flex items-start gap-2">
          <Icon name="circle-alert" size={20} className="mt-0.5 text-warning" />
          <p className="text-base text-text">{gpsNotice}</p>
        </Card>
      ) : null}

      {tab === "gps" ? (
        <section
          id="location-panel-gps"
          role="tabpanel"
          aria-labelledby="location-tab-gps"
          className="flex flex-col gap-3"
        >
          {gps.phase === "idle" || gps.phase === "locating" ? (
            <LoadingState message="現在地を取得しています" />
          ) : gps.phase === "loading" ? (
            <LoadingState message="近くのスポットを探しています" />
          ) : gps.phase === "error" ? (
            <ErrorMessage
              message={gps.message}
              onRetry={() =>
                gps.retry === "fetch" && gps.position ? void fetchNearby(gps.position) : void locate()
              }
            />
          ) : (
            <GpsResult
              position={gps.position}
              nearby={gps.nearby}
              selectedKey={selectedKey}
              creatingNew={creatingNew}
              newSpotName={newSpotName}
              newSpotNameError={newSpotNameError}
              onSelect={selectExisting}
              onStartNew={() => startNewSpot(gps.position)}
              onCancelNew={() => {
                setCreatingNew(false);
                if (value?.newSpot?.source === "gps") onChange(null);
              }}
              onNameChange={(name) => updateNewSpotName(name, gps.position)}
              onRelocate={() => void locate()}
            />
          )}
        </section>
      ) : (
        <section
          id="location-panel-search"
          role="tabpanel"
          aria-labelledby="location-tab-search"
          className="flex flex-col gap-3"
        >
          <form onSubmit={submitSearch} className="flex gap-2" role="search">
            <FormField label="スポット名" className="flex-1">
              {({ id }) => (
                <Input
                  id={id}
                  type="search"
                  value={query}
                  placeholder="例：兼六園"
                  maxLength={100}
                  enterKeyHint="search"
                  autoComplete="off"
                  onChange={(e) => setQuery(e.target.value)}
                />
              )}
            </FormField>
            <Button
              type="submit"
              leftIcon="search"
              className="self-end"
              disabled={query.trim().length === 0 || search.phase === "loading"}
              loading={search.phase === "loading"}
            >
              検索
            </Button>
          </form>
          {search.phase === "idle" ? (
            <p className="text-base text-text-muted">スポット名を入力して「検索」を押してください。</p>
          ) : search.phase === "loading" ? (
            <LoadingState message="検索しています" />
          ) : search.phase === "error" ? (
            <ErrorMessage message={search.message} onRetry={() => void runSearch(search.q)} />
          ) : (
            <SearchResult
              result={search.result}
              q={search.q}
              selectedKey={selectedKey}
              onSelect={selectCandidate}
            />
          )}
        </section>
      )}

      <WizardFooter onBack={onBack} onNext={onNext} nextDisabled={value === null} />
    </div>
  );
}

// ---------- GPS の候補一覧 ----------

interface GpsResultProps {
  position: CurrentLocation;
  nearby: NearbyResponse;
  selectedKey: string | null;
  creatingNew: boolean;
  newSpotName: string;
  newSpotNameError?: string;
  onSelect: (spot: NearbySpot) => void;
  onStartNew: () => void;
  onCancelNew: () => void;
  onNameChange: (name: string) => void;
  onRelocate: () => void;
}

function GpsResult({
  position,
  nearby,
  selectedKey,
  creatingNew,
  newSpotName,
  newSpotNameError,
  onSelect,
  onStartNew,
  onCancelNew,
  onNameChange,
  onRelocate,
}: GpsResultProps) {
  const spots = [...nearby.spots].sort((a, b) => a.distanceM - b.distanceM).slice(0, LIMITS.nearbyMax);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-base text-text-muted">現在地の誤差：約{Math.round(position.accuracyM)}m</p>
        <Button variant="ghost" leftIcon="refresh-cw" onClick={onRelocate}>
          現在地を取得し直す
        </Button>
      </div>

      {!nearby.canCreate ? (
        <Card tone="warning" role="status" className="flex items-start gap-2">
          <Icon name="circle-alert" size={20} className="mt-0.5 text-warning" />
          <p className="text-base text-text">{GPS_INACCURATE_MESSAGE}</p>
        </Card>
      ) : null}

      {spots.length === 0 ? (
        <EmptyState
          icon="map-pin"
          title="近くに登録済みのスポットがありません"
          description={
            nearby.canCreate
              ? "新しいスポットとして登録するか、スポット名で検索してください。"
              : "スポット名で検索してください。"
          }
        />
      ) : (
        <ul className="flex flex-col gap-2" aria-label="近くのスポット">
          {spots.map((spot) => (
            <li key={spot.id}>
              <CandidateButton
                selected={selectedKey === `spot:${spot.id}`}
                onClick={() => onSelect(spot)}
                thumbUrl={spot.coverThumbUrl}
                category={spot.category}
                name={spot.name}
                meta={`${formatDistance(spot.distanceM)} / 投稿 ${spot.postCount} 件`}
              />
            </li>
          ))}
        </ul>
      )}

      {nearby.canCreate ? (
        creatingNew ? (
          <Card className="flex flex-col gap-3">
            <FormField
              label="スポット名"
              required
              hint={`${LIMITS.spotNameMin}〜${LIMITS.spotNameMax}文字。現在地の座標で登録します`}
              error={newSpotNameError}
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  value={newSpotName}
                  maxLength={LIMITS.spotNameMax}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  autoFocus
                  onChange={(e) => onNameChange(e.target.value)}
                />
              )}
            </FormField>
            <Button variant="ghost" leftIcon="x" onClick={onCancelNew} className="self-start">
              新規登録をやめる
            </Button>
          </Card>
        ) : (
          <Button variant="secondary" leftIcon="plus" onClick={onStartNew}>
            新しいスポットとして登録
          </Button>
        )
      ) : null}
    </div>
  );
}

// ---------- 検索結果 ----------

interface SearchResultProps {
  result: PlacesSearchResponse;
  q: string;
  selectedKey: string | null;
  onSelect: (c: PlaceCandidate) => void;
}

function SearchResult({ result, q, selectedKey, onSelect }: SearchResultProps) {
  return (
    <div className="flex flex-col gap-3">
      {result.externalUnavailable ? (
        <SuspendedNotice feature="external_search" detail="登録済みのスポットのみ表示しています。" />
      ) : null}
      {result.results.length === 0 ? (
        <EmptyState
          icon="search"
          title={`「${q}」に一致する場所が見つかりませんでした`}
          description="別の言葉で検索するか、「現在地から選ぶ」をお試しください。"
        />
      ) : (
        <ul className="flex flex-col gap-2" aria-label="検索結果">
          {result.results.map((c) => {
            const key = c.source === "db" ? `spot:${c.id}` : `new:${c.id}`;
            return (
              <li key={`${c.source}:${c.id}`}>
                <CandidateButton
                  selected={selectedKey === key}
                  onClick={() => onSelect(c)}
                  name={c.name}
                  meta={c.address ?? [c.prefecture, c.city].filter(Boolean).join("")}
                  badge={
                    c.source === "db" ? (
                      <Badge icon="map-pin" tone="muted">
                        登録済み
                      </Badge>
                    ) : (
                      <Badge icon="plus" tone="primary">
                        新しいスポット
                      </Badge>
                    )
                  }
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------- 候補ボタン ----------

interface CandidateButtonProps {
  selected: boolean;
  onClick: () => void;
  name: string;
  meta?: string;
  thumbUrl?: string | null;
  category?: NearbySpot["category"];
  badge?: React.ReactNode;
}

function CandidateButton({ selected, onClick, name, meta, thumbUrl, category, badge }: CandidateButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "flex min-h-11 w-full items-center gap-3 rounded-card border p-3 text-left transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        selected ? "border-primary bg-primary-soft" : "border-border bg-surface hover:bg-surface-muted",
      )}
    >
      {category ? (
        <PhotoImage
          src={thumbUrl}
          alt=""
          category={category}
          fallbackIconSize={20}
          className="size-12 shrink-0 rounded-card"
        />
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="break-words text-base font-medium text-text">{name}</span>
        {meta ? <span className="text-base text-text-muted">{meta}</span> : null}
        {category ? (
          <span className="text-base text-text-muted">
            <CategoryLabel category={category} />
          </span>
        ) : null}
        {badge ? <span className="self-start">{badge}</span> : null}
      </span>
      {selected ? <Icon name="check" size={20} className="text-primary-strong" /> : null}
    </button>
  );
}
