"use client";

/**
 * S-01 マップ（トップ）画面の本体（F-1）。
 * - 地図：SpotMapLazy ＋ useViewportSpots（表示範囲内のスポットを取得）
 * - 上部：検索バー（/search へ）、カテゴリ絞り込み（F-1-7）
 * - 右下：現在地ボタン（F-1-8）
 * - 写真ピンのタップ：スマホはボトムシート、PC（lg 以上）は左パネルで SpotPeekCard を表示（F-1-6）
 * - 初期表示：URL ハッシュがあればその位置、なければ日本全体を出しつつ位置情報を 1 回だけ試す（F-1-1、Q17）
 */
import Link from "next/link";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ListPicker } from "@/components/list/ListPicker";
import {
  LocateButton,
  SpotMapLazy,
  getCurrentPosition,
  useMap,
  useViewportSpots,
  type CurrentLocation,
} from "@/components/map";
import { useSystemStatus } from "@/components/system/SystemStatusProvider";
import {
  BottomSheet,
  Button,
  ButtonLink,
  Card,
  ErrorMessage,
  Icon,
  IconButton,
  Spinner,
  SuspendedNotice,
  cn,
  useIsDesktop,
} from "@/components/ui";
import { MAP_ZOOM } from "@/lib/domain/constants";
import type { SpotSummary } from "@/lib/domain/types";
import { getInitialView, parseHash } from "@/lib/map";
import { CategoryFilter } from "./CategoryFilter";
import { SpotPeekCard } from "./SpotPeekCard";
import { VisibleSpotList } from "./VisibleSpotList";

/** ブラウザの URL ハッシュに地図の位置が入っているか（あれば位置情報より優先する） */
function hasViewHash(): boolean {
  if (typeof window === "undefined") return false;
  return parseHash(window.location.hash) !== null;
}

/**
 * 初期表示の位置情報（F-1-1）。ユーザー操作なしで 1 回だけ現在地を取り、取得できたら flyTo する。
 * 拒否・失敗時は何もせず日本全体のまま。URL ハッシュがある（詳細から戻った等）ときも何もしない。
 * SpotMapLazy の children として置き、useMap() で地図を使う。
 */
function AutoLocate() {
  const { map, ready, showLocation } = useMap();
  const attemptedRef = useRef(false);
  const doneRef = useRef(false);
  const userMovedRef = useRef(false);
  const [position, setPosition] = useState<CurrentLocation | null>(null);

  useEffect(() => {
    if (attemptedRef.current) return;
    attemptedRef.current = true;
    if (hasViewHash()) {
      doneRef.current = true;
      return;
    }
    let active = true;
    getCurrentPosition({ enableHighAccuracy: false, maximumAgeMs: 60_000 })
      .then((loc) => {
        if (active) setPosition(loc);
      })
      .catch(() => {
        // 拒否・失敗は黙って日本全体のまま（F-1-1）
        doneRef.current = true;
      });
    return () => {
      active = false;
    };
  }, []);

  // ユーザーが先に地図を動かしたら、後から来た現在地で飛ばさない
  useEffect(() => {
    if (!map) return;
    const mark = () => {
      userMovedRef.current = true;
    };
    map.on("dragstart", mark);
    map.on("wheel", mark);
    return () => {
      map.off("dragstart", mark);
      map.off("wheel", mark);
    };
  }, [map]);

  useEffect(() => {
    if (doneRef.current || !position || !map || !ready) return;
    doneRef.current = true;
    showLocation(position);
    if (userMovedRef.current || hasViewHash()) return;
    map.flyTo({ center: [position.lng, position.lat], zoom: MAP_ZOOM.initialWithLocation, duration: 1200 });
  }, [position, map, ready, showLocation]);

  return null;
}

export function MapHome() {
  const isDesktop = useIsDesktop();
  const { loading: statusLoading, isSuspended } = useSystemStatus();
  const postCreateSuspended = !statusLoading && isSuspended("post_create");

  const { data, spots, heatPoints, loading, error, refetch, setViewport, categories, setCategories } =
    useViewportSpots();

  const [selectedSpot, setSelectedSpot] = useState<SpotSummary | null>(null);
  const [listOpen, setListOpen] = useState(false);

  // 最新の取得結果に同じスポットがあれば件数などを新しい値にする
  const selected = useMemo(() => {
    if (!selectedSpot) return null;
    return spots.find((s) => s.id === selectedSpot.id) ?? selectedSpot;
  }, [selectedSpot, spots]);

  const initialView = useMemo(() => getInitialView(null), []);

  const handleSpotTap = useCallback((spot: SpotSummary) => {
    setSelectedSpot(spot);
  }, []);
  const closeSelected = useCallback(() => {
    setSelectedSpot(null);
    setListOpen(false);
  }, []);
  const openListPicker = useCallback(() => setListOpen(true), []);
  const closeListPicker = useCallback(() => setListOpen(false), []);

  const handleMapReady = useCallback((map: MapLibreMap) => {
    // 地図の空白部分をクリックしたら選択を解除する
    map.on("click", () => setSelectedSpot(null));
  }, []);

  const isEmptyArea =
    !loading &&
    !error &&
    data !== null &&
    ((data.mode === "spots" && data.spots.length === 0) ||
      (data.mode === "heatmap" && data.points.length === 0));

  const sheetOpen = !isDesktop && selected !== null;

  return (
    <div className="flex min-h-0 flex-1">
      {/* PC：左パネル（一覧 or 詳細カード） */}
      <aside
        aria-label="表示範囲のスポット"
        className="hidden w-[420px] shrink-0 flex-col border-r border-border bg-surface lg:flex"
      >
        {isDesktop ? (
          selected ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center gap-2 border-b border-border px-2 py-2">
                <IconButton icon="chevron-left" aria-label="一覧に戻る" onClick={closeSelected} />
                <h2 className="min-w-0 flex-1 truncate text-lg font-semibold text-text">{selected.name}</h2>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <SpotPeekCard
                  spot={selected}
                  hideName
                  onAddToList={openListPicker}
                  postCreateSuspended={postCreateSuspended}
                />
              </div>
            </div>
          ) : (
            <VisibleSpotList
              data={data}
              spots={spots}
              loading={loading}
              selectedSpotId={null}
              onSelect={handleSpotTap}
              postCreateSuspended={postCreateSuspended}
            />
          )
        ) : null}
      </aside>

      {/* 地図 */}
      <div className="relative min-h-0 min-w-0 flex-1">
        <SpotMapLazy
          className="h-full w-full"
          spots={spots}
          heatPoints={heatPoints}
          initialView={initialView}
          useHash
          onViewportChange={setViewport}
          selectedSpotId={selected?.id ?? null}
          onSpotTap={handleSpotTap}
          onMapReady={handleMapReady}
        >
          <AutoLocate />
          <div
            className={cn(
              "absolute right-3 z-10 transition-[bottom] duration-200",
              sheetOpen ? "bottom-[calc(40dvh+0.75rem)]" : "bottom-3",
            )}
          >
            <LocateButton />
          </div>
        </SpotMapLazy>

        {/* 上部：検索バー・カテゴリ絞り込み */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col gap-2 p-3">
          <div className="flex items-center gap-2">
            <Link
              href="/search"
              className="pointer-events-auto flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-card border border-border bg-surface px-4 text-base text-text-muted shadow-[var(--shadow-card)] hover:bg-surface-muted"
            >
              <Icon name="search" size={20} />
              <span className="truncate">スポットを検索</span>
            </Link>
            {loading ? (
              <span className="pointer-events-auto flex size-11 items-center justify-center rounded-full border border-border bg-surface shadow-[var(--shadow-card)]">
                <Spinner size={20} label="スポットを取得中" />
              </span>
            ) : null}
          </div>
          <CategoryFilter value={categories} onChange={setCategories} className="pointer-events-auto" />
        </div>

        {/* 範囲内に投稿なし（F-1 例外）・API エラー */}
        {error || isEmptyArea ? (
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 z-10 flex justify-center px-3 transition-[bottom] duration-200",
              sheetOpen ? "bottom-[calc(40dvh+0.75rem)]" : "bottom-3",
            )}
          >
            {error ? (
              <ErrorMessage
                message={error}
                onRetry={refetch}
                retrying={loading}
                className="pointer-events-auto w-full max-w-md"
              />
            ) : (
              <Card className="pointer-events-auto flex w-full max-w-md flex-col gap-3">
                <p className="flex items-center gap-2 text-base text-text">
                  <Icon name="info" size={20} className="text-text-muted" />
                  このエリアにはまだ投稿がありません
                </p>
                {postCreateSuspended ? (
                  <>
                    <SuspendedNotice feature="post_create" />
                    <Button leftIcon="camera" disabled fullWidth>
                      投稿する
                    </Button>
                  </>
                ) : (
                  <ButtonLink href="/posts/new" leftIcon="camera" fullWidth>
                    投稿する
                  </ButtonLink>
                )}
              </Card>
            )}
          </div>
        ) : null}
      </div>

      {/* スマホ：ボトムシート（F-1-6） */}
      {selected ? (
        <BottomSheet
          open={sheetOpen}
          onClose={closeSelected}
          title={selected.name}
          initialSnap="peek"
          desktop="panel"
        >
          <SpotPeekCard
            spot={selected}
            hideName
            onAddToList={openListPicker}
            postCreateSuspended={postCreateSuspended}
          />
        </BottomSheet>
      ) : null}

      {/* 行きたい場所リストに追加（リスト担当の部品） */}
      {selected ? <ListPicker spotId={selected.id} open={listOpen} onClose={closeListPicker} /> : null}
    </div>
  );
}
