/**
 * ブラウザ側の区画（タイル）キャッシュの純粋ロジック（F-1-2 の詳細、ADR-0024）。
 * - どの区画を取りに行くか（表示範囲＋少し外側を表示用、外側 1 画面分を先読み）
 * - 取得済みの区画のデータを結合して画面に出す形にする（id で重複排除）
 * - 新しいデータが届くまで前のピンを残す（まだ取得していない区画にある前回のピンだけを引き継ぐ）
 * フック（src/components/map/useViewportSpots.ts）はこのファイルの関数を呼ぶだけにして、ここを単体テストする。
 */
import { TILE_ZOOMS, type Category } from "@/lib/domain/constants";
import type { HeatPoint, SpotSummary, SpotsInViewResponse } from "@/lib/domain/types";
import { fetchZoomFor, lngLatToTile, tileKey, tilesForBbox, type TileCoord } from "./tiles";
import type { MapBbox } from "./view";

/** 1 区画分のレスポンス（GET /spots/tiles/{z}/{x}/{y} と同じ形） */
export type TileData = SpotsInViewResponse;

/** 画面に出す区画：表示範囲の外側にこの割合だけ広げる（小さな移動でピンが消えないように） */
export const VISIBLE_PADDING = 0.2;
/** 先読みする区画：表示範囲の外側 1 画面分 */
export const PREFETCH_PADDING = 1;
/** 1 回の計画で画面に出す区画の上限（ズーム 5 で日本全体を見たときなど） */
export const MAX_VISIBLE_TILES = 256;
/** 先読みを含めた取得対象の上限（中心に近いものを優先） */
export const MAX_PREFETCH_TILES = 64;
/** ブラウザに保持する区画数の上限。超えたら古いものから捨てる */
export const MAX_CACHE_ENTRIES = 1024;

/** 絞り込み条件を表す文字列。順序と重複に依らず同じ値になる（キャッシュのキーに含める） */
export function categoriesKey(categories: readonly Category[]): string {
  return [...new Set(categories)].sort().join(",");
}

/** キャッシュのキー：絞り込み条件 ＋ タイル番号 */
export function cacheKey(catKey: string, tile: TileCoord): string {
  return `${catKey}|${tileKey(tile)}`;
}

/** GET /spots/tiles/{z}/{x}/{y}[?category=a,b] のパス（api クライアントのベースパスを除く） */
export function tileRequestPath(tile: TileCoord, categories: readonly Category[]): string {
  const base = `/spots/tiles/${tile.z}/${tile.x}/${tile.y}`;
  const key = categoriesKey(categories);
  return key ? `${base}?category=${encodeURIComponent(key)}` : base;
}

export function isHeatmapZoom(z: number): boolean {
  return z === TILE_ZOOMS[0];
}

export interface TilePlan {
  /** 取得用ズーム段階（8 / 11 / 14） */
  z: number;
  catKey: string;
  /** 画面に出す区画（表示範囲＋少し外側）。中心に近い順 */
  visible: TileCoord[];
  /** 取りに行く区画（表示用 → 先読みの順。取得済み・取得中のものは除く） */
  missing: TileCoord[];
}

export interface PlanInput {
  bbox: MapBbox;
  /** 表示ズーム（小数のまま） */
  zoom: number;
  categories: readonly Category[];
  /** 取得済み、または取得中なら true */
  has: (key: string) => boolean;
}

/** 表示範囲から「画面に出す区画」と「取りに行く区画」を決める */
export function planTiles({ bbox, zoom, categories, has }: PlanInput): TilePlan {
  const z = fetchZoomFor(zoom);
  const catKey = categoriesKey(categories);
  const visible = tilesForBbox(bbox, z, VISIBLE_PADDING, MAX_VISIBLE_TILES);
  const prefetch = tilesForBbox(bbox, z, PREFETCH_PADDING, MAX_PREFETCH_TILES);
  const seen = new Set<string>();
  const missing: TileCoord[] = [];
  for (const tile of [...visible, ...prefetch]) {
    const key = cacheKey(catKey, tile);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!has(key)) missing.push(tile);
  }
  return { z, catKey, visible, missing };
}

export interface CarryOver {
  spots: readonly SpotSummary[];
  points: readonly HeatPoint[];
}

export interface MergeResult {
  mode: "spots" | "heatmap";
  spots: SpotSummary[];
  points: HeatPoint[];
  /** 画面に出す区画のうち取得済みの数 */
  loaded: number;
  total: number;
  /** 画面に出す区画がすべて取得済みか（空表示の判定に使う） */
  complete: boolean;
}

const EMPTY_CARRY: CarryOver = { spots: [], points: [] };

/**
 * 画面に出す区画のデータを結合する。スポットは id、ヒートマップの点は座標で重複を除く。
 * まだ取得していない区画については、前回表示していたもの（carry）のうちその区画に入るものを残す。
 */
export function mergeVisible(
  plan: Pick<TilePlan, "z" | "catKey" | "visible">,
  get: (key: string) => TileData | undefined,
  carry: CarryOver = EMPTY_CARRY,
): MergeResult {
  const mode = isHeatmapZoom(plan.z) ? "heatmap" : "spots";
  const visibleKeys = new Set<string>();
  const loadedKeys = new Set<string>();
  const spotsById = new Map<string, SpotSummary>();
  const pointsByPos = new Map<string, HeatPoint>();
  for (const tile of plan.visible) {
    const tKey = tileKey(tile);
    visibleKeys.add(tKey);
    const data = get(cacheKey(plan.catKey, tile));
    if (!data) continue;
    loadedKeys.add(tKey);
    if (data.mode === "spots") {
      for (const s of data.spots) if (!spotsById.has(s.id)) spotsById.set(s.id, s);
    } else {
      for (const p of data.points) {
        const k = `${p.lat},${p.lng}`;
        if (!pointsByPos.has(k)) pointsByPos.set(k, p);
      }
    }
  }
  const total = plan.visible.length;
  const complete = loadedKeys.size === total;
  if (!complete) {
    const pending = (lng: number, lat: number) => {
      const k = tileKey(lngLatToTile(lng, lat, plan.z));
      return visibleKeys.has(k) && !loadedKeys.has(k);
    };
    if (mode === "spots") {
      for (const s of carry.spots) {
        if (!spotsById.has(s.id) && pending(s.lng, s.lat)) spotsById.set(s.id, s);
      }
    } else {
      for (const p of carry.points) {
        const k = `${p.lat},${p.lng}`;
        if (!pointsByPos.has(k) && pending(p.lng, p.lat)) pointsByPos.set(k, p);
      }
    }
  }
  return {
    mode,
    spots: mode === "spots" ? [...spotsById.values()] : [],
    points: mode === "heatmap" ? [...pointsByPos.values()] : [],
    loaded: loadedKeys.size,
    total,
    complete,
  };
}

/** 上限を超えた分を古い順（挿入順）に捨てる。戻り値は捨てた数 */
export function pruneCache<V>(cache: Map<string, V>, max = MAX_CACHE_ENTRIES): number {
  let removed = 0;
  for (const key of cache.keys()) {
    if (cache.size <= max) break;
    cache.delete(key);
    removed++;
  }
  return removed;
}

// ---------- 取得の制御（並列数・中断・キュー） ----------

export interface TileViewState {
  mode: "spots" | "heatmap";
  spots: SpotSummary[];
  heatPoints: HeatPoint[];
  /** 画面に出す区画がすべて取得済みか */
  complete: boolean;
  /** 取得用ズーム段階 */
  z: number;
  /** 取得中・取得待ちの区画があるか */
  loading: boolean;
}

export type FetchTile = (
  tile: TileCoord,
  categories: readonly Category[],
  signal: AbortSignal,
) => Promise<TileData>;

export interface TileLoaderOptions {
  fetchTile: FetchTile;
  onChange: (state: TileViewState) => void;
  /** 同時に取得する区画数（既定 6） */
  maxConcurrent?: number;
  maxCacheEntries?: number;
}

interface Job {
  key: string;
  tile: TileCoord;
  catKey: string;
  categories: Category[];
}

interface Inflight {
  controller: AbortController;
  catKey: string;
  z: number;
}

/**
 * 区画の取得をまとめる（React に依存しない）。
 * - setViewport / setCategories のたびに計画を立て直し、未取得の区画だけをキューに入れる
 * - 同時 maxConcurrent 件まで並列。ズーム段階・絞り込みが変わったら古い取得を AbortController で中断
 * - 失敗した区画は取得済みに入れない（次の移動時に再取得）。エラーは表に出さない
 * - 取得できるたびに onChange で画面用の状態を通知する
 */
export class TileLoader {
  private readonly cache = new Map<string, TileData>();
  private readonly inflight = new Map<string, Inflight>();
  private queue: Job[] = [];
  private plan: TilePlan | null = null;
  private viewport: { bbox: MapBbox; zoom: number } | null = null;
  private categories: Category[] = [];
  private carry: CarryOver = EMPTY_CARRY;
  private disposed = false;
  private readonly fetchTile: FetchTile;
  private readonly onChange: (state: TileViewState) => void;
  private readonly maxConcurrent: number;
  private readonly maxCacheEntries: number;

  constructor(options: TileLoaderOptions) {
    this.fetchTile = options.fetchTile;
    this.onChange = options.onChange;
    this.maxConcurrent = options.maxConcurrent ?? 6;
    this.maxCacheEntries = options.maxCacheEntries ?? MAX_CACHE_ENTRIES;
  }

  get inflightCount(): number {
    return this.inflight.size;
  }

  get cachedCount(): number {
    return this.cache.size;
  }

  hasTile(catKey: string, tile: TileCoord): boolean {
    return this.cache.has(cacheKey(catKey, tile));
  }

  setViewport(bbox: MapBbox, zoom: number): void {
    this.viewport = { bbox, zoom };
    this.update();
  }

  setCategories(categories: readonly Category[]): void {
    this.categories = [...categories];
    // 絞り込みが変わったら前のピンは引き継がない（別の条件のデータなので）
    this.carry = EMPTY_CARRY;
    this.update();
  }

  /** 同じ表示範囲で未取得（失敗したものを含む）の区画を取り直す */
  retry(): void {
    this.update();
  }

  /** 取得済みを捨てて表示範囲を取り直す */
  invalidate(): void {
    this.cache.clear();
    for (const [key, job] of this.inflight) {
      job.controller.abort();
      this.inflight.delete(key);
    }
    this.update();
  }

  dispose(): void {
    this.disposed = true;
    this.queue = [];
    for (const [key, job] of this.inflight) {
      job.controller.abort();
      this.inflight.delete(key);
    }
  }

  private update(): void {
    if (this.disposed || !this.viewport) return;
    const plan = planTiles({
      bbox: this.viewport.bbox,
      zoom: this.viewport.zoom,
      categories: this.categories,
      has: (key) => this.cache.has(key) || this.inflight.has(key),
    });
    this.plan = plan;
    // 古いズーム段階・別の絞り込みの取得は中断する
    for (const [key, job] of this.inflight) {
      if (job.catKey !== plan.catKey || job.z !== plan.z) {
        job.controller.abort();
        this.inflight.delete(key);
      }
    }
    const categories = [...this.categories];
    this.queue = plan.missing.map((tile) => ({
      key: cacheKey(plan.catKey, tile),
      tile,
      catKey: plan.catKey,
      categories,
    }));
    this.pump();
    this.publish();
  }

  private pump(): void {
    while (!this.disposed && this.inflight.size < this.maxConcurrent && this.queue.length > 0) {
      const job = this.queue.shift()!;
      if (this.cache.has(job.key) || this.inflight.has(job.key)) continue;
      const controller = new AbortController();
      this.inflight.set(job.key, { controller, catKey: job.catKey, z: job.tile.z });
      this.fetchTile(job.tile, job.categories, controller.signal)
        .then((data) => {
          if (controller.signal.aborted || this.disposed) return;
          this.cache.set(job.key, data);
          pruneCache(this.cache, this.maxCacheEntries);
          if (this.plan && job.catKey === this.plan.catKey && job.tile.z === this.plan.z) this.publish();
        })
        .catch(() => {
          // 失敗した区画は取得済みに入れない。次の移動時に再取得する（F-1 例外）
        })
        .finally(() => {
          if (this.inflight.get(job.key)?.controller === controller) this.inflight.delete(job.key);
          this.pump();
          // 最後の取得が終わったら loading: false を伝える
          if (!controller.signal.aborted && this.inflight.size === 0) this.publish();
        });
    }
  }

  private publish(): void {
    const plan = this.plan;
    if (!plan || this.disposed) return;
    const merged = mergeVisible(plan, (key) => this.cache.get(key), this.carry);
    this.carry = { spots: merged.spots, points: merged.points };
    this.onChange({
      mode: merged.mode,
      spots: merged.spots,
      heatPoints: merged.points,
      complete: merged.complete,
      z: plan.z,
      loading: this.inflight.size > 0 || this.queue.length > 0,
    });
  }
}

// ---------- 間引き（移動中は最大 300ms に 1 回） ----------

export interface Throttled<A extends unknown[]> {
  (...args: A): void;
  /** 待っている呼び出しがあればすぐ実行する（移動が止まったとき） */
  flush: () => void;
  cancel: () => void;
}

/**
 * 先頭と末尾で呼ぶ throttle。間隔内の呼び出しは最後の引数だけを残し、間隔が空いたら実行する。
 * setTimeout を使うので vitest の fake timers でテストできる。
 */
export function throttle<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
  now: () => number = () => Date.now(),
): Throttled<A> {
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;
  const run = () => {
    timer = null;
    if (!pending) return;
    const args = pending;
    pending = null;
    last = now();
    fn(...args);
  };
  const throttled = ((...args: A) => {
    pending = args;
    const wait = last + ms - now();
    if (wait <= 0) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      run();
    } else if (!timer) {
      timer = setTimeout(run, wait);
    }
  }) as Throttled<A>;
  throttled.flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    run();
  };
  throttled.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  };
  return throttled;
}
