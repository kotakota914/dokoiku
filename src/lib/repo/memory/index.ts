/**
 * Memory Repository：Supabase なしで全機能を動かすプロセス内実装。
 * - 単一インスタンスを globalThis に保持する（next dev の HMR でも消えない）。
 * - serverConfig.memoryPersist が true なら <dataDir>/memory.json に 500ms デバウンスで保存し、起動時に読み込む。
 * - 画像ファイルは <dataDir>/uploads/ に置き、/api/dev/uploads と /api/dev/files が読み書きする。
 * - "server-only" は呼び出し側の src/lib/repo/index.ts に任せる（vitest の node 環境から import できるように）。
 * - 権限チェックは行わない（API 側の責務）。見つからないときは null を返す。
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  LIMITS,
  type Category,
  type Feature,
  type StayDuration,
  type TravelMode,
} from "@/lib/domain/constants";
import type {
  ApiUsage,
  HeatPoint,
  NearbySpot,
  Page,
  Plan,
  PlanParams,
  PlanResult,
  PlanSummary,
  Post,
  PostImage,
  PostImageView,
  PostView,
  Profile,
  Report,
  SharedWishlist,
  Spot,
  SpotDetail,
  SpotSummary,
  SuspendedFeature,
  TravelTimeEntry,
  UploadRequestFile,
  UploadTarget,
  Wishlist,
  WishlistDetail,
  WishlistItem,
} from "@/lib/domain/types";
import { popularityOf } from "@/lib/domain/constants";
import { serverConfig } from "@/lib/config";
import { decodeCursor, encodeCursor, type CursorValue } from "@/lib/api/cursor";
import { haversineM, inBbox as pointInBbox, normalizeName } from "@/lib/utils/geo";
import { newId } from "@/lib/utils/id";
import { nowIso } from "@/lib/utils/time";
import type {
  ApiUsageRepo,
  Bbox,
  LikesRepo,
  Paging,
  PlansRepo,
  PostsRepo,
  ProfilesRepo,
  ReportsRepo,
  Repository,
  SpotsRepo,
  StorageRepo,
  TravelCacheRepo,
  WishlistsRepo,
} from "../types";
import {
  computeSpotStats,
  createEmptyState,
  fromSnapshot,
  likeKey,
  toSnapshot,
  travelKey,
  usageKey,
  type MemoryState,
  type StoredImage,
  type WishlistRow,
} from "./model";
import { buildSeedData } from "./seed";

export { buildSeedData, SEED_USER_IDS, SEED_USER_ID_LIST, seedSpotInfo } from "./seed";

const SAVE_DEBOUNCE_MS = 500;
const UPLOAD_TOKEN_TTL_MS = 60 * 60 * 1000;
const GLOBAL_KEY = "__dokoiko_memory_repository__";

export interface MemoryRepositoryOptions {
  /** 保存先ディレクトリ。既定は serverConfig.dataDir */
  dataDir?: string;
  /** memory.json へ保存するか。既定は serverConfig.memoryPersist */
  persist?: boolean;
}

/** 時間に依存する処理は now を渡せる（テスト用。契約の型は変えない） */
export interface MemoryPostsRepo extends PostsRepo {
  countRecentByUser(userId: string, windowMs: number, now?: Date): Promise<number>;
}
export interface MemoryTravelCacheRepo extends TravelCacheRepo {
  getMany(
    pairs: { fromKey: string; toKey: string }[],
    mode: TravelMode,
    now?: Date,
  ): Promise<Map<string, TravelTimeEntry>>;
  purgeExpired(olderThanDays: number, now?: Date): Promise<number>;
}
export interface MemoryStorageRepo extends StorageRepo {
  createSignedUploads(userId: string, files: UploadRequestFile[], now?: Date): Promise<UploadTarget[]>;
  deleteStaleTmp(olderThanHours: number, now?: Date): Promise<number>;
}

/** Repository に開発用ルートが使う操作を足したもの */
export interface MemoryRepository extends Repository {
  readonly backend: "memory";
  readonly dataDir: string;
  posts: MemoryPostsRepo;
  travelCache: MemoryTravelCacheRepo;
  storage: MemoryStorageRepo;
  /** /api/dev/uploads：署名付き URL のトークンを検証する */
  verifyUploadToken(uploadPath: string, token: string, now?: Date): boolean;
  /** /api/dev/uploads：<dataDir>/uploads/<path> に保存する */
  writeUploadFile(uploadPath: string, data: Uint8Array): Promise<void>;
  /** /api/dev/files：<dataDir>/uploads/<path> を読む。無ければ null */
  readUploadFile(uploadPath: string): Promise<Buffer | null>;
  /** 保留中の保存を完了させる（テスト・終了処理用） */
  flush(): Promise<void>;
}

// ---------- 共通ヘルパー ----------

/** createdAt desc, id desc の比較 */
function byNewest<T extends { createdAt: string; id: string }>(a: T, b: T): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** createdAt desc, id desc で並んだ配列をカーソルで切る */
function paginateNewest<T extends { createdAt: string; id: string }>(sorted: T[], paging: Paging): Page<T> {
  return paginate(
    sorted,
    paging,
    (t) => ({ createdAt: t.createdAt, id: t.id }),
    (t, c) => t.createdAt < c.createdAt || (t.createdAt === c.createdAt && t.id < c.id),
  );
}

function paginate<T>(
  sorted: T[],
  paging: Paging,
  toCursor: (t: T) => CursorValue,
  isAfter: (t: T, cursor: CursorValue) => boolean,
): Page<T> {
  const limit = Math.max(1, paging.limit);
  const cursor = decodeCursor(paging.cursor);
  const rest = cursor ? sorted.filter((t) => isAfter(t, cursor)) : sorted;
  const items = rest.slice(0, limit);
  const nextCursor =
    rest.length > limit && items.length > 0 ? encodeCursor(toCursor(items[items.length - 1])) : null;
  return { items, nextCursor };
}

function safeRelativePath(p: string): string | null {
  if (!p || p.startsWith("/") || p.includes("\\") || p.split("/").some((seg) => seg === "" || seg === ".."))
    return null;
  return p;
}

function isSeedPath(p: string): boolean {
  return p.startsWith("seed/");
}

// ---------- 実装 ----------

class MemoryRepositoryImpl implements MemoryRepository {
  readonly backend = "memory" as const;
  readonly dataDir: string;
  private readonly persist: boolean;
  private state: MemoryState;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> | null = null;
  private dirty = false;
  private readonly uploadTokens = new Map<string, { path: string; userId: string; expiresAt: number }>();

  readonly profiles: ProfilesRepo;
  readonly spots: SpotsRepo;
  readonly posts: MemoryPostsRepo;
  readonly likes: LikesRepo;
  readonly wishlists: WishlistsRepo;
  readonly plans: PlansRepo;
  readonly travelCache: MemoryTravelCacheRepo;
  readonly apiUsage: ApiUsageRepo;
  readonly reports: ReportsRepo;
  readonly storage: MemoryStorageRepo;

  constructor(seed: boolean, options: MemoryRepositoryOptions) {
    this.dataDir = options.dataDir ?? serverConfig.dataDir;
    this.persist = options.persist ?? serverConfig.memoryPersist;
    this.state = this.loadInitialState(seed);

    this.profiles = this.buildProfiles();
    this.spots = this.buildSpots();
    this.posts = this.buildPosts();
    this.likes = this.buildLikes();
    this.wishlists = this.buildWishlists();
    this.plans = this.buildPlans();
    this.travelCache = this.buildTravelCache();
    this.apiUsage = this.buildApiUsage();
    this.reports = this.buildReports();
    this.storage = this.buildStorage();
  }

  // ----- 永続化 -----

  private get snapshotPath(): string {
    return path.join(this.dataDir, "memory.json");
  }

  private get uploadsDir(): string {
    return path.join(this.dataDir, "uploads");
  }

  private loadInitialState(seed: boolean): MemoryState {
    if (this.persist) {
      try {
        if (fs.existsSync(this.snapshotPath)) {
          const raw: unknown = JSON.parse(fs.readFileSync(this.snapshotPath, "utf8"));
          const loaded = fromSnapshot(raw);
          if (loaded) return loaded;
          console.warn(`[memory] ${this.snapshotPath} の形式が不正なため初期データを使います`);
        }
      } catch (err) {
        console.warn(`[memory] ${this.snapshotPath} を読み込めませんでした。初期データを使います`, err);
      }
    }
    const state = createEmptyState();
    if (seed) {
      const data = buildSeedData();
      for (const p of data.profiles) state.profiles.set(p.id, p);
      for (const s of data.spots) state.spots.set(s.id, s);
      for (const p of data.posts) state.posts.set(p.id, p);
      for (const img of data.images) {
        const list = state.images.get(img.postId) ?? [];
        list.push(img);
        state.images.set(img.postId, list);
      }
      for (const l of data.likes) state.likes.set(likeKey(l.userId, l.postId), l);
    }
    return state;
  }

  /** 変更のたびに呼ぶ。500ms デバウンスで保存する */
  private changed(): void {
    if (!this.persist) return;
    this.dirty = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, SAVE_DEBOUNCE_MS);
    // 保存待ちでプロセスの終了を妨げない
    if (typeof this.saveTimer === "object" && "unref" in this.saveTimer) this.saveTimer.unref();
  }

  private async save(): Promise<void> {
    if (this.saving) {
      await this.saving;
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.saving = (async () => {
      try {
        await fsp.mkdir(this.dataDir, { recursive: true });
        const tmp = `${this.snapshotPath}.tmp`;
        await fsp.writeFile(tmp, JSON.stringify(toSnapshot(this.state, nowIso())), "utf8");
        await fsp.rename(tmp, this.snapshotPath);
      } catch (err) {
        console.error("[memory] memory.json の保存に失敗しました", err);
      } finally {
        this.saving = null;
      }
    })();
    await this.saving;
  }

  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.save();
  }

  // ----- 内部の組み立て -----

  private imagesOf(postId: string): StoredImage[] {
    return this.state.images.get(postId) ?? [];
  }

  private isAdmin(userId: string | null | undefined): boolean {
    return Boolean(userId && this.state.profiles.get(userId)?.isAdmin);
  }

  private canSee(post: Post, viewerId: string | null | undefined): boolean {
    if (post.status === "public") return true;
    if (!viewerId) return false;
    return post.userId === viewerId || this.isAdmin(viewerId);
  }

  private toImageView(img: PostImage): PostImageView {
    return {
      id: img.id,
      fullUrl: this.storage.publicUrl(img.fullPath),
      thumbUrl: this.storage.publicUrl(img.thumbPath),
      width: img.width,
      height: img.height,
      sortOrder: img.sortOrder,
      fullPath: img.fullPath,
      thumbPath: img.thumbPath,
    };
  }

  private toPostView(post: Post, viewerId?: string | null): PostView {
    const author = this.state.profiles.get(post.userId);
    const spot = this.state.spots.get(post.spotId);
    return {
      ...post,
      author: {
        id: post.userId,
        displayName: author?.displayName ?? "退会したユーザー",
        avatarUrl: author?.avatarUrl ?? null,
      },
      spotName: spot?.name ?? "",
      images: [...this.imagesOf(post.id)]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((img) => this.toImageView(img)),
      likedByMe: viewerId ? this.state.likes.has(likeKey(viewerId, post.id)) : false,
    };
  }

  private coverThumbUrl(spot: Spot): string | null {
    const img = this.findImage(spot.coverImageId);
    return img ? this.storage.publicUrl(img.thumbPath) : null;
  }

  private findImage(imageId: string | null): StoredImage | null {
    if (!imageId) return null;
    for (const list of this.state.images.values()) {
      const hit = list.find((i) => i.id === imageId);
      if (hit) return hit;
    }
    return null;
  }

  private toSpotSummary(spot: Spot): SpotSummary {
    return {
      id: spot.id,
      name: spot.name,
      lat: spot.lat,
      lng: spot.lng,
      category: spot.category,
      postCount: spot.postCount,
      likeCount: spot.likeCount,
      popularity: popularityOf(spot.postCount),
      coverThumbUrl: this.coverThumbUrl(spot),
      prefecture: spot.prefecture,
      city: spot.city,
    };
  }

  private toSpotDetail(spot: Spot): SpotDetail {
    const cover = this.findImage(spot.coverImageId);
    return {
      ...this.toSpotSummary(spot),
      address: spot.address,
      stayMinutesMedian: spot.stayMinutesMedian,
      hourHistogram: [...spot.hourHistogram],
      openingHours: spot.openingHours,
      coverFullUrl: cover ? this.storage.publicUrl(cover.fullPath) : null,
      createdAt: spot.createdAt,
    };
  }

  /** 地図・検索に出すスポット（公開投稿が1件以上。F-2-14） */
  private visibleSpots(): Spot[] {
    return [...this.state.spots.values()].filter((s) => s.postCount > 0);
  }

  private recomputeSpot(spotId: string): void {
    const spot = this.state.spots.get(spotId);
    if (!spot) return;
    const posts = [...this.state.posts.values()].filter((p) => p.spotId === spotId);
    this.state.spots.set(
      spotId,
      computeSpotStats(spot, posts, (id) => this.imagesOf(id)),
    );
  }

  private toWishlist(row: WishlistRow): Wishlist {
    return { ...row, itemCount: this.state.wishlistItems.filter((i) => i.wishlistId === row.id).length };
  }

  private wishlistItemsOf(listId: string): WishlistItem[] {
    const rows = this.state.wishlistItems
      .filter((i) => i.wishlistId === listId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return rows.map((row) => {
      const spot = this.state.spots.get(row.spotId);
      return {
        spotId: row.spotId,
        mustVisit: row.mustVisit,
        createdAt: row.createdAt,
        spot: spot ? this.toSpotSummary(spot) : null,
      };
    });
  }

  private toPlanSummary(plan: Plan): PlanSummary {
    return {
      id: plan.id,
      wishlistId: plan.wishlistId,
      date: plan.date,
      spotCount: plan.spotCount,
      totalTravelMin: plan.totalTravelMin,
      createdAt: plan.createdAt,
    };
  }

  /** 投稿を削除し、画像パスを返す（スポットの再計算は呼び出し側） */
  private removePost(postId: string): string[] {
    const paths: string[] = [];
    for (const img of this.imagesOf(postId)) paths.push(img.fullPath, img.thumbPath);
    this.state.images.delete(postId);
    this.state.posts.delete(postId);
    for (const [key, like] of this.state.likes) if (like.postId === postId) this.state.likes.delete(key);
    for (const [id, r] of this.state.reports) if (r.postId === postId) this.state.reports.delete(id);
    return paths;
  }

  // ----- profiles -----

  private buildProfiles(): ProfilesRepo {
    return {
      getById: async (id) => this.state.profiles.get(id) ?? null,
      create: async (input) => {
        const existing = this.state.profiles.get(input.id);
        if (existing) return existing;
        const profile: Profile = {
          id: input.id,
          displayName: input.displayName,
          avatarUrl: input.avatarUrl ?? null,
          isAdmin: false,
          createdAt: nowIso(),
        };
        this.state.profiles.set(profile.id, profile);
        this.changed();
        return profile;
      },
      update: async (id, patch) => {
        const current = this.state.profiles.get(id);
        if (!current) throw new Error(`profile not found: ${id}`);
        const next: Profile = {
          ...current,
          ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
          ...(patch.avatarUrl !== undefined ? { avatarUrl: patch.avatarUrl } : {}),
        };
        this.state.profiles.set(id, next);
        this.changed();
        return next;
      },
      deleteAccount: async (id) => {
        const deletedImagePaths: string[] = [];
        const affectedSpots = new Set<string>();

        // 自分の投稿（画像・いいね・通報も一緒に）
        for (const post of [...this.state.posts.values()]) {
          if (post.userId !== id) continue;
          affectedSpots.add(post.spotId);
          deletedImagePaths.push(...this.removePost(post.id));
        }
        // 自分が付けたいいね
        for (const [key, like] of [...this.state.likes]) {
          if (like.userId !== id) continue;
          this.state.likes.delete(key);
          const post = this.state.posts.get(like.postId);
          if (post) {
            post.likeCount = Math.max(0, post.likeCount - 1);
            affectedSpots.add(post.spotId);
          }
        }
        // リストとプラン
        for (const [listId, list] of [...this.state.wishlists]) {
          if (list.userId !== id) continue;
          this.state.wishlists.delete(listId);
          this.state.wishlistItems = this.state.wishlistItems.filter((i) => i.wishlistId !== listId);
          for (const [planId, plan] of [...this.state.plans])
            if (plan.wishlistId === listId) this.state.plans.delete(planId);
        }
        for (const [planId, plan] of [...this.state.plans])
          if (plan.userId === id) this.state.plans.delete(planId);
        // 自分が行った通報
        for (const [reportId, r] of [...this.state.reports])
          if (r.reporterId === id) this.state.reports.delete(reportId);

        this.state.profiles.delete(id);
        for (const spotId of affectedSpots) this.recomputeSpot(spotId);
        this.changed();
        return { deletedImagePaths };
      },
    };
  }

  // ----- spots -----

  private buildSpots(): SpotsRepo {
    const filterBbox = (bbox: Bbox, categories?: Category[]) =>
      this.visibleSpots()
        .filter((s) => pointInBbox(s, bbox))
        .filter((s) => !categories || categories.length === 0 || categories.includes(s.category))
        .sort((a, b) => b.postCount - a.postCount || b.likeCount - a.likeCount || a.id.localeCompare(b.id));

    return {
      inBbox: async ({ bbox, categories, limit }) =>
        filterBbox(bbox, categories)
          .slice(0, limit)
          .map((s) => this.toSpotSummary(s)),
      heatmap: async ({ bbox, categories, limit }): Promise<HeatPoint[]> =>
        filterBbox(bbox, categories)
          .slice(0, limit)
          .map((s) => ({ lat: s.lat, lng: s.lng, weight: s.postCount })),
      nearby: async ({ lat, lng, radiusM, limit }): Promise<NearbySpot[]> =>
        this.visibleSpots()
          .map((s) => ({ spot: s, distanceM: haversineM({ lat, lng }, s) }))
          .filter((x) => x.distanceM <= radiusM)
          .sort((a, b) => a.distanceM - b.distanceM || a.spot.id.localeCompare(b.spot.id))
          .slice(0, limit)
          .map((x) => ({ ...this.toSpotSummary(x.spot), distanceM: Math.round(x.distanceM) })),
      search: async ({ keyword, prefecture, city, category, sort, paging }) => {
        const kw = keyword ? normalizeName(keyword) : "";
        const pref = prefecture ? normalizeName(prefecture) : "";
        const ct = city ? normalizeName(city) : "";
        let list = this.visibleSpots().filter((s) => {
          if (category && s.category !== category) return false;
          if (pref && !normalizeName(s.prefecture ?? "").includes(pref)) return false;
          if (ct && !normalizeName(s.city ?? "").includes(ct)) return false;
          if (kw) {
            const hay = [s.name, s.address ?? "", s.prefecture ?? "", s.city ?? ""].map(normalizeName);
            if (!hay.some((h) => h.includes(kw))) return false;
          }
          return true;
        });
        if (sort === "newest") {
          list = list.sort(byNewest);
          const page = paginateNewest(list, paging);
          return { items: page.items.map((s) => this.toSpotSummary(s)), nextCursor: page.nextCursor };
        }
        // popular：score desc, id desc。カーソルの createdAt 欄に score を入れる
        const score = (s: Spot) => s.postCount + s.likeCount;
        list = list.sort((a, b) => score(b) - score(a) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
        const page = paginate(
          list,
          paging,
          (s) => ({ createdAt: String(score(s)), id: s.id }),
          (s, c) => {
            const cs = Number(c.createdAt);
            return score(s) < cs || (score(s) === cs && s.id < c.id);
          },
        );
        return { items: page.items.map((s) => this.toSpotSummary(s)), nextCursor: page.nextCursor };
      },
      getById: async (id) => {
        const spot = this.state.spots.get(id);
        return spot ? this.toSpotDetail(spot) : null;
      },
      getManyByIds: async (ids) =>
        ids
          .map((id) => this.state.spots.get(id))
          .filter((s): s is Spot => Boolean(s))
          .map((s) => this.toSpotSummary(s)),
      findSimilarName: async ({ name, lat, lng, radiusM }) => {
        const target = normalizeName(name);
        return [...this.state.spots.values()]
          .filter((s) => haversineM({ lat, lng }, s) <= radiusM)
          .filter((s) => {
            const n = normalizeName(s.name);
            if (!target || !n) return false;
            return n === target || n.includes(target) || target.includes(n);
          })
          .sort((a, b) => haversineM({ lat, lng }, a) - haversineM({ lat, lng }, b))
          .map((s) => this.toSpotSummary(s));
      },
      create: async (input) => {
        const spot: Spot = {
          id: newId(),
          name: input.name,
          lat: input.lat,
          lng: input.lng,
          address: input.address ?? null,
          prefecture: input.prefecture ?? null,
          city: input.city ?? null,
          category: input.category,
          source: input.source,
          externalRef: input.externalRef ?? null,
          postCount: 0,
          likeCount: 0,
          coverImageId: null,
          stayMinutesMedian: null,
          hourHistogram: new Array<number>(24).fill(0),
          openingHours: null,
          createdBy: input.createdBy,
          createdAt: nowIso(),
        };
        this.state.spots.set(spot.id, spot);
        this.changed();
        return spot;
      },
      recomputeStats: async (spotId) => {
        this.recomputeSpot(spotId);
        this.changed();
      },
    };
  }

  // ----- posts -----

  private buildPosts(): MemoryPostsRepo {
    const listVisible = (
      pred: (p: Post) => boolean,
      paging: Paging,
      viewerId?: string | null,
    ): Page<PostView> => {
      const list = [...this.state.posts.values()]
        .filter((p) => pred(p) && this.canSee(p, viewerId))
        .sort(byNewest);
      const page = paginateNewest(list, paging);
      return { items: page.items.map((p) => this.toPostView(p, viewerId)), nextCursor: page.nextCursor };
    };
    const setImages = (postId: string, images: Omit<PostImage, "id">[]) => {
      const stored: StoredImage[] = images
        .map((img, idx) => ({ ...img, id: newId(), postId, sortOrder: img.sortOrder ?? idx }))
        .sort((a, b) => a.sortOrder - b.sortOrder);
      this.state.images.set(postId, stored);
    };

    const impl = {
      listBySpot: async (spotId: string, paging: Paging, viewerId?: string | null) =>
        listVisible((p) => p.spotId === spotId, paging, viewerId),
      listByUser: async (userId: string, paging: Paging, viewerId?: string | null) =>
        listVisible((p) => p.userId === userId, paging, viewerId),
      getById: async (id: string, viewerId?: string | null) => {
        const post = this.state.posts.get(id);
        if (!post || !this.canSee(post, viewerId)) return null;
        return this.toPostView(post, viewerId);
      },
      create: async (input: {
        userId: string;
        spotId: string;
        comment: string;
        category: Category;
        stayDuration: StayDuration | null;
        images: Omit<PostImage, "id">[];
      }) => {
        const now = nowIso();
        const post: Post = {
          id: newId(),
          userId: input.userId,
          spotId: input.spotId,
          comment: input.comment,
          category: input.category,
          stayDuration: input.stayDuration,
          likeCount: 0,
          status: "public",
          createdAt: now,
          updatedAt: now,
        };
        this.state.posts.set(post.id, post);
        setImages(post.id, input.images);
        this.recomputeSpot(post.spotId);
        this.changed();
        return this.toPostView(post, input.userId);
      },
      update: async (
        id: string,
        patch: {
          comment?: string;
          category?: Category;
          stayDuration?: StayDuration | null;
          images?: Omit<PostImage, "id">[];
        },
      ) => {
        const post = this.state.posts.get(id);
        if (!post) throw new Error(`post not found: ${id}`);
        if (patch.comment !== undefined) post.comment = patch.comment;
        if (patch.category !== undefined) post.category = patch.category;
        if (patch.stayDuration !== undefined) post.stayDuration = patch.stayDuration;
        if (patch.images !== undefined) setImages(id, patch.images);
        post.updatedAt = nowIso();
        this.recomputeSpot(post.spotId);
        this.changed();
        return this.toPostView(post, post.userId);
      },
      delete: async (id: string) => {
        const post = this.state.posts.get(id);
        if (!post) return { deletedImagePaths: [] };
        const deletedImagePaths = this.removePost(id);
        this.recomputeSpot(post.spotId);
        this.changed();
        return { deletedImagePaths };
      },
      setStatus: async (id: string, status: "public" | "hidden") => {
        const post = this.state.posts.get(id);
        if (!post) return;
        post.status = status;
        post.updatedAt = nowIso();
        this.recomputeSpot(post.spotId);
        this.changed();
      },
      countRecentByUser: async (userId: string, windowMs: number, now: Date = new Date()) => {
        const since = now.getTime() - windowMs;
        let n = 0;
        for (const p of this.state.posts.values()) {
          if (p.userId === userId && new Date(p.createdAt).getTime() >= since) n += 1;
        }
        return n;
      },
    };
    return impl;
  }

  // ----- likes -----

  private buildLikes(): LikesRepo {
    return {
      add: async (userId, postId) => {
        const post = this.state.posts.get(postId);
        if (!post) return { likeCount: 0 };
        const key = likeKey(userId, postId);
        if (!this.state.likes.has(key)) {
          this.state.likes.set(key, { userId, postId, createdAt: nowIso() });
          post.likeCount += 1;
          this.recomputeSpot(post.spotId);
          this.changed();
        }
        return { likeCount: post.likeCount };
      },
      remove: async (userId, postId) => {
        const post = this.state.posts.get(postId);
        if (!post) return { likeCount: 0 };
        const key = likeKey(userId, postId);
        if (this.state.likes.delete(key)) {
          post.likeCount = Math.max(0, post.likeCount - 1);
          this.recomputeSpot(post.spotId);
          this.changed();
        }
        return { likeCount: post.likeCount };
      },
    };
  }

  // ----- wishlists -----

  private buildWishlists(): WishlistsRepo {
    const rowsOf = (userId: string) =>
      [...this.state.wishlists.values()].filter((w) => w.userId === userId).sort(byNewest);
    return {
      listByUser: async (userId) => rowsOf(userId).map((w) => this.toWishlist(w)),
      countByUser: async (userId) => rowsOf(userId).length,
      create: async ({ userId, name }) => {
        const row: WishlistRow = { id: newId(), userId, name, shareToken: null, createdAt: nowIso() };
        this.state.wishlists.set(row.id, row);
        this.changed();
        return this.toWishlist(row);
      },
      getById: async (id): Promise<WishlistDetail | null> => {
        const row = this.state.wishlists.get(id);
        if (!row) return null;
        return {
          ...this.toWishlist(row),
          items: this.wishlistItemsOf(id),
          plans: await this.plans.listByWishlist(id),
        };
      },
      rename: async (id, name) => {
        const row = this.state.wishlists.get(id);
        if (!row) throw new Error(`wishlist not found: ${id}`);
        row.name = name;
        this.changed();
        return this.toWishlist(row);
      },
      delete: async (id) => {
        if (!this.state.wishlists.delete(id)) return;
        this.state.wishlistItems = this.state.wishlistItems.filter((i) => i.wishlistId !== id);
        for (const [planId, plan] of [...this.state.plans])
          if (plan.wishlistId === id) this.state.plans.delete(planId);
        this.changed();
      },
      addItem: async (listId, spotId) => {
        const count = () => this.state.wishlistItems.filter((i) => i.wishlistId === listId).length;
        if (!this.state.wishlists.has(listId)) return { added: false, itemCount: 0 };
        if (this.state.wishlistItems.some((i) => i.wishlistId === listId && i.spotId === spotId)) {
          return { added: false, itemCount: count() };
        }
        this.state.wishlistItems.push({ wishlistId: listId, spotId, mustVisit: false, createdAt: nowIso() });
        this.changed();
        return { added: true, itemCount: count() };
      },
      setMustVisit: async (listId, spotId, mustVisit) => {
        const item = this.state.wishlistItems.find((i) => i.wishlistId === listId && i.spotId === spotId);
        if (!item) return false;
        item.mustVisit = mustVisit;
        this.changed();
        return true;
      },
      removeItem: async (listId, spotId) => {
        const before = this.state.wishlistItems.length;
        this.state.wishlistItems = this.state.wishlistItems.filter(
          (i) => !(i.wishlistId === listId && i.spotId === spotId),
        );
        const removed = this.state.wishlistItems.length < before;
        if (removed) this.changed();
        return removed;
      },
      setShareToken: async (listId, token) => {
        const row = this.state.wishlists.get(listId);
        if (!row) return;
        row.shareToken = token;
        this.changed();
      },
      getByShareToken: async (token): Promise<SharedWishlist | null> => {
        if (!token) return null;
        const row = [...this.state.wishlists.values()].find((w) => w.shareToken === token);
        if (!row) return null;
        const owner = this.state.profiles.get(row.userId);
        return {
          name: row.name,
          ownerDisplayName: owner?.displayName ?? "退会したユーザー",
          items: this.wishlistItemsOf(row.id),
        };
      },
    };
  }

  // ----- plans -----

  private buildPlans(): PlansRepo {
    return {
      create: async ({
        userId,
        wishlistId,
        params,
        result,
      }: {
        userId: string;
        wishlistId: string;
        params: PlanParams;
        result: PlanResult;
      }) => {
        const plan: Plan = {
          id: newId(),
          wishlistId,
          userId,
          date: params.date,
          spotCount: result.items.filter((i) => i.type === "spot").length,
          totalTravelMin: result.totalTravelMin,
          createdAt: nowIso(),
          params,
          result,
        };
        this.state.plans.set(plan.id, plan);
        this.changed();
        return plan;
      },
      getById: async (id) => this.state.plans.get(id) ?? null,
      listByWishlist: async (wishlistId) =>
        [...this.state.plans.values()]
          .filter((p) => p.wishlistId === wishlistId)
          .sort(byNewest)
          .map((p) => this.toPlanSummary(p)),
      delete: async (id) => {
        if (this.state.plans.delete(id)) this.changed();
      },
    };
  }

  // ----- travelCache -----

  private buildTravelCache(): MemoryTravelCacheRepo {
    const isExpired = (entry: TravelTimeEntry, now: Date) =>
      new Date(entry.fetchedAt).getTime() + LIMITS.travelCacheDays * 86_400_000 <= now.getTime();
    return {
      getMany: async (
        pairs: { fromKey: string; toKey: string }[],
        mode: TravelMode,
        now: Date = new Date(),
      ) => {
        const out = new Map<string, TravelTimeEntry>();
        for (const { fromKey, toKey } of pairs) {
          const entry = this.state.travelCache.get(travelKey(fromKey, toKey, mode));
          if (entry && !isExpired(entry, now)) out.set(`${fromKey}|${toKey}`, entry);
        }
        return out;
      },
      putMany: async (entries) => {
        const fetchedAt = nowIso();
        for (const e of entries)
          this.state.travelCache.set(travelKey(e.fromKey, e.toKey, e.mode), { ...e, fetchedAt });
        if (entries.length) this.changed();
      },
      purgeExpired: async (olderThanDays: number, now: Date = new Date()) => {
        const threshold = now.getTime() - olderThanDays * 86_400_000;
        let n = 0;
        for (const [key, e] of [...this.state.travelCache]) {
          if (new Date(e.fetchedAt).getTime() <= threshold) {
            this.state.travelCache.delete(key);
            n += 1;
          }
        }
        if (n) this.changed();
        return n;
      },
    };
  }

  // ----- apiUsage -----

  private buildApiUsage(): ApiUsageRepo {
    const upsert = (provider: string, feature: Feature, period: string, limit: number): ApiUsage => {
      const key = usageKey(provider, feature, period);
      let row = this.state.apiUsage.get(key);
      if (!row) {
        row = { provider, feature, period, count: 0, limit, suspendedAt: null };
        this.state.apiUsage.set(key, row);
      }
      return row;
    };
    return {
      get: async (provider, feature, period) => {
        const row = this.state.apiUsage.get(usageKey(provider, feature, period));
        return row ? { ...row } : null;
      },
      increment: async (provider, feature, period, limit, by = 1) => {
        const row = upsert(provider, feature, period, limit);
        row.count += by;
        this.changed();
        return { ...row };
      },
      set: async (provider, feature, period, count, limit) => {
        const row = upsert(provider, feature, period, limit);
        row.count = count;
        row.limit = limit;
        this.changed();
        return { ...row };
      },
      setSuspended: async (provider, feature, period, suspendedAt) => {
        const row = this.state.apiUsage.get(usageKey(provider, feature, period));
        if (!row) return;
        row.suspendedAt = suspendedAt;
        this.changed();
      },
      listSuspended: async (periods): Promise<SuspendedFeature[]> => {
        const set = new Set(periods);
        const out: SuspendedFeature[] = [];
        for (const row of this.state.apiUsage.values()) {
          if (row.suspendedAt && set.has(row.period)) {
            out.push({
              feature: row.feature,
              provider: row.provider,
              period: row.period,
              count: row.count,
              limit: row.limit,
              suspendedAt: row.suspendedAt,
            });
          }
        }
        return out;
      },
    };
  }

  // ----- reports -----

  private buildReports(): ReportsRepo {
    const openCount = (postId: string) =>
      [...this.state.reports.values()].filter((r) => r.postId === postId && r.status === "open").length;
    return {
      create: async ({ postId, reporterId, reason, note }) => {
        const dup = [...this.state.reports.values()].some(
          (r) => r.postId === postId && r.reporterId === reporterId,
        );
        if (dup) return { created: false, count: openCount(postId) };
        const report: Report = {
          id: newId(),
          postId,
          reporterId,
          reason,
          note,
          status: "open",
          createdAt: nowIso(),
        };
        this.state.reports.set(report.id, report);
        this.changed();
        return { created: true, count: openCount(postId) };
      },
      listOpen: async (paging) => {
        const list = [...this.state.reports.values()].filter((r) => r.status === "open").sort(byNewest);
        const page = paginateNewest(list, paging);
        return {
          items: page.items.map((r) => {
            const post = this.state.posts.get(r.postId);
            // 管理者向けなので hidden でも返す
            return { ...r, post: post ? this.toPostView(post, null) : null };
          }),
          nextCursor: page.nextCursor,
        };
      },
      resolveByPost: async (postId) => {
        let changed = false;
        for (const r of this.state.reports.values()) {
          if (r.postId === postId && r.status === "open") {
            r.status = "resolved";
            changed = true;
          }
        }
        if (changed) this.changed();
      },
    };
  }

  // ----- storage -----

  private buildStorage(): MemoryStorageRepo {
    const uploadsDir = () => this.uploadsDir;
    return {
      createSignedUploads: async (
        userId: string,
        files: UploadRequestFile[],
        now: Date = new Date(),
      ): Promise<UploadTarget[]> => {
        const out: UploadTarget[] = [];
        let pendingFullId: string | null = null;
        for (const f of files) {
          let name: string;
          if (f.kind === "full") {
            pendingFullId = newId();
            name = `${pendingFullId}.webp`;
          } else {
            // 直前の full と同じ ID を使って対応づける
            const id = pendingFullId ?? newId();
            pendingFullId = null;
            name = `${id}_t.webp`;
          }
          const uploadPath = `posts/tmp/${userId}/${name}`;
          const token = newId().replace(/-/g, "");
          this.uploadTokens.set(token, {
            path: uploadPath,
            userId,
            expiresAt: now.getTime() + UPLOAD_TOKEN_TTL_MS,
          });
          out.push({
            kind: f.kind,
            path: uploadPath,
            signedUrl: `/api/dev/uploads?path=${encodeURIComponent(uploadPath)}&token=${token}`,
          });
        }
        return out;
      },
      finalizePostImages: async (postId, images) => {
        const out: { fullPath: string; thumbPath: string }[] = [];
        const move = async (src: string): Promise<string> => {
          if (isSeedPath(src)) return src;
          const rel = safeRelativePath(src);
          if (!rel) throw new Error(`invalid image path: ${src}`);
          const from = path.join(uploadsDir(), rel);
          if (!fs.existsSync(from)) throw new Error(`uploaded file not found: ${src}`);
          const dest = `posts/${postId}/${path.basename(rel)}`;
          const to = path.join(uploadsDir(), dest);
          await fsp.mkdir(path.dirname(to), { recursive: true });
          await fsp.rename(from, to);
          return dest;
        };
        for (const img of images) {
          out.push({ fullPath: await move(img.fullPath), thumbPath: await move(img.thumbPath) });
        }
        return out;
      },
      deleteObjects: async (paths) => {
        for (const p of paths) {
          if (isSeedPath(p)) continue;
          const rel = safeRelativePath(p);
          if (!rel) continue;
          await fsp.rm(path.join(uploadsDir(), rel), { force: true });
        }
      },
      publicUrl: (p) => `/api/dev/files/${p}`,
      deleteStaleTmp: async (olderThanHours: number, now: Date = new Date()) => {
        const threshold = now.getTime() - olderThanHours * 3_600_000;
        for (const [token, t] of [...this.uploadTokens])
          if (t.expiresAt <= now.getTime()) this.uploadTokens.delete(token);
        const root = path.join(uploadsDir(), "posts", "tmp");
        if (!fs.existsSync(root)) return 0;
        let n = 0;
        const walk = async (dir: string) => {
          for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              await walk(full);
            } else if (entry.isFile()) {
              const st = await fsp.stat(full);
              if (st.mtimeMs <= threshold) {
                await fsp.rm(full, { force: true });
                n += 1;
              }
            }
          }
        };
        await walk(root);
        return n;
      },
    };
  }

  // ----- 開発用ルートが使う操作 -----

  verifyUploadToken(uploadPath: string, token: string, now: Date = new Date()): boolean {
    const t = this.uploadTokens.get(token);
    if (!t) return false;
    if (t.expiresAt <= now.getTime()) {
      this.uploadTokens.delete(token);
      return false;
    }
    return t.path === uploadPath;
  }

  async writeUploadFile(uploadPath: string, data: Uint8Array): Promise<void> {
    const rel = safeRelativePath(uploadPath);
    if (!rel) throw new Error(`invalid upload path: ${uploadPath}`);
    const full = path.join(this.uploadsDir, rel);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, data);
  }

  async readUploadFile(uploadPath: string): Promise<Buffer | null> {
    const rel = safeRelativePath(uploadPath);
    if (!rel) return null;
    try {
      return await fsp.readFile(path.join(this.uploadsDir, rel));
    } catch {
      return null;
    }
  }
}

/** 新しいインスタンスを作る（テスト用。seed=false なら空の状態から始める） */
export function createMemoryRepository(seed = true, options: MemoryRepositoryOptions = {}): MemoryRepository {
  return new MemoryRepositoryImpl(seed, options);
}

type GlobalWithRepo = typeof globalThis & { [GLOBAL_KEY]?: MemoryRepository };

/** プロセス内の単一インスタンス（HMR で消えないよう globalThis に保持） */
export function getMemoryRepository(): MemoryRepository {
  const g = globalThis as GlobalWithRepo;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = createMemoryRepository(true);
  return g[GLOBAL_KEY];
}
