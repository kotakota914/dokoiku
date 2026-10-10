/**
 * Memory Repository が保持する行の型と、保存形（JSON）との相互変換、スポット統計の計算。
 * seed.ts と index.ts の両方から使う純粋なモジュール（fs は使わない）。
 */
import { LIMITS, STAY_DURATION_MINUTES, type Category } from "@/lib/domain/constants";
import type {
  ApiUsage,
  Plan,
  Post,
  PostImage,
  Profile,
  Report,
  Spot,
  TravelTimeEntry,
} from "@/lib/domain/types";
import { jstHour } from "@/lib/utils/time";

/** 投稿に紐づく画像（post_images 行） */
export interface StoredImage extends PostImage {
  postId: string;
}

export interface LikeRow {
  userId: string;
  postId: string;
  createdAt: string;
}

/** wishlists 行（itemCount は保持せず、取得時に数える） */
export interface WishlistRow {
  id: string;
  userId: string;
  name: string;
  shareToken: string | null;
  createdAt: string;
}

export interface WishlistItemRow {
  wishlistId: string;
  spotId: string;
  mustVisit: boolean;
  createdAt: string;
}

/** プロセス内で保持する状態 */
export interface MemoryState {
  profiles: Map<string, Profile>;
  spots: Map<string, Spot>;
  posts: Map<string, Post>;
  /** postId -> 画像（sortOrder 順） */
  images: Map<string, StoredImage[]>;
  /** `${userId}|${postId}` -> いいね */
  likes: Map<string, LikeRow>;
  wishlists: Map<string, WishlistRow>;
  wishlistItems: WishlistItemRow[];
  plans: Map<string, Plan>;
  /** `${fromKey}|${toKey}|${mode}` -> キャッシュ */
  travelCache: Map<string, TravelTimeEntry>;
  /** `${provider}|${feature}|${period}` -> 使用量 */
  apiUsage: Map<string, ApiUsage>;
  reports: Map<string, Report>;
}

/** memory.json の形 */
export interface MemorySnapshot {
  version: 1;
  savedAt: string;
  profiles: Profile[];
  spots: Spot[];
  posts: Post[];
  images: StoredImage[];
  likes: LikeRow[];
  wishlists: WishlistRow[];
  wishlistItems: WishlistItemRow[];
  plans: Plan[];
  travelCache: TravelTimeEntry[];
  apiUsage: ApiUsage[];
  reports: Report[];
}

export function likeKey(userId: string, postId: string): string {
  return `${userId}|${postId}`;
}

export function travelKey(fromKey: string, toKey: string, mode: string): string {
  return `${fromKey}|${toKey}|${mode}`;
}

export function usageKey(provider: string, feature: string, period: string): string {
  return `${provider}|${feature}|${period}`;
}

export function createEmptyState(): MemoryState {
  return {
    profiles: new Map(),
    spots: new Map(),
    posts: new Map(),
    images: new Map(),
    likes: new Map(),
    wishlists: new Map(),
    wishlistItems: [],
    plans: new Map(),
    travelCache: new Map(),
    apiUsage: new Map(),
    reports: new Map(),
  };
}

export function toSnapshot(state: MemoryState, savedAt: string): MemorySnapshot {
  return {
    version: 1,
    savedAt,
    profiles: [...state.profiles.values()],
    spots: [...state.spots.values()],
    posts: [...state.posts.values()],
    images: [...state.images.values()].flat(),
    likes: [...state.likes.values()],
    wishlists: [...state.wishlists.values()],
    wishlistItems: [...state.wishlistItems],
    plans: [...state.plans.values()],
    travelCache: [...state.travelCache.values()],
    apiUsage: [...state.apiUsage.values()],
    reports: [...state.reports.values()],
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** JSON から状態を復元する。形が違えば null */
export function fromSnapshot(raw: unknown): MemoryState | null {
  if (!isRecord(raw) || raw.version !== 1) return null;
  const keys = [
    "profiles",
    "spots",
    "posts",
    "images",
    "likes",
    "wishlists",
    "wishlistItems",
    "plans",
    "travelCache",
    "apiUsage",
    "reports",
  ] as const;
  for (const k of keys) {
    if (!Array.isArray(raw[k])) return null;
  }
  const snap = raw as unknown as MemorySnapshot;
  const state = createEmptyState();
  for (const p of snap.profiles) state.profiles.set(p.id, p);
  for (const s of snap.spots) state.spots.set(s.id, s);
  for (const p of snap.posts) state.posts.set(p.id, p);
  for (const img of snap.images) {
    const list = state.images.get(img.postId) ?? [];
    list.push(img);
    state.images.set(img.postId, list);
  }
  for (const list of state.images.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);
  for (const l of snap.likes) state.likes.set(likeKey(l.userId, l.postId), l);
  for (const w of snap.wishlists) state.wishlists.set(w.id, w);
  state.wishlistItems = [...snap.wishlistItems];
  for (const p of snap.plans) state.plans.set(p.id, p);
  for (const t of snap.travelCache) state.travelCache.set(travelKey(t.fromKey, t.toKey, t.mode), t);
  for (const u of snap.apiUsage) state.apiUsage.set(usageKey(u.provider, u.feature, u.period), u);
  for (const r of snap.reports) state.reports.set(r.id, r);
  return state;
}

/**
 * F-2-13：スポットの統計を投稿から計算する（純粋関数）。
 * - postCount / likeCount：public の投稿のみ
 * - coverImageId：いいね数が最多の public 投稿の最初の画像（同数なら新しい投稿）
 * - stayMinutesMedian：stayDuration ありの投稿が LIMITS.stayMedianMinPosts 件以上なら中央値（偶数なら小さい方）
 * - hourHistogram：public 投稿の createdAt を日本時間の時で集計（24要素）
 * - category：投稿で最も多いカテゴリ。同数なら現状維持
 */
export function computeSpotStats(spot: Spot, posts: Post[], imagesOf: (postId: string) => PostImage[]): Spot {
  const pub = posts.filter((p) => p.spotId === spot.id && p.status === "public");
  const postCount = pub.length;
  const likeCount = pub.reduce((sum, p) => sum + p.likeCount, 0);

  let best: Post | null = null;
  let coverImageId: string | null = null;
  for (const p of pub) {
    const imgs = [...imagesOf(p.id)].sort((a, b) => a.sortOrder - b.sortOrder);
    if (imgs.length === 0) continue;
    if (
      !best ||
      p.likeCount > best.likeCount ||
      (p.likeCount === best.likeCount && p.createdAt > best.createdAt)
    ) {
      best = p;
      coverImageId = imgs[0].id;
    }
  }

  const minutes = pub
    .filter((p): p is Post & { stayDuration: NonNullable<Post["stayDuration"]> } => p.stayDuration !== null)
    .map((p) => STAY_DURATION_MINUTES[p.stayDuration])
    .sort((a, b) => a - b);
  const stayMinutesMedian =
    minutes.length >= LIMITS.stayMedianMinPosts ? minutes[Math.floor((minutes.length - 1) / 2)] : null;

  const hourHistogram = new Array<number>(24).fill(0);
  for (const p of pub) hourHistogram[jstHour(p.createdAt)] += 1;

  const counts = new Map<Category, number>();
  for (const p of pub) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  let category = spot.category;
  let max = 0;
  let tie = false;
  let top: Category | null = null;
  for (const [c, n] of counts) {
    if (n > max) {
      max = n;
      top = c;
      tie = false;
    } else if (n === max) {
      tie = true;
    }
  }
  if (top && !tie) category = top;

  return { ...spot, postCount, likeCount, coverImageId, stayMinutesMedian, hourHistogram, category };
}
