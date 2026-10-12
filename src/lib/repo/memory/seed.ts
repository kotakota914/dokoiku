/**
 * memory モードの初期データ（Q16）。金沢市・野々市市の実在スポット約40件
 * （金沢工業大学 扇が丘キャンパスの学内スポットを含む）と開発用ユーザー3人。
 * - スポットの元データは seed-data/kanazawa/spots.json（supabase/seed.sql と写真取得ツールも同じファイルを使う）。
 * - 写真は seed-data/kanazawa/photos.json（写真取得ツールが生成。無ければ空配列）。
 *   そのスポットの写真があれば投稿へ順番に割り当て、無ければ "seed/<spotId>/<n>.svg" の
 *   プレースホルダー（/api/dev/files が SVG を生成）にする。
 * - buildSeedData() は決定的（乱数は固定シードの PRNG）で、入力が同じなら毎回同じデータを返す。
 */
import type { Category, StayDuration } from "@/lib/domain/constants";
import { CATEGORIES, STAY_DURATIONS } from "@/lib/domain/constants";
import type { Post, Profile, Spot } from "@/lib/domain/types";
import spotsJson from "../../../../seed-data/kanazawa/spots.json";
import photosJson from "../../../../seed-data/kanazawa/photos.json";
import { computeSpotStats, type LikeRow, type StoredImage } from "./model";

export interface SeedData {
  profiles: Profile[];
  spots: Spot[];
  posts: Post[];
  images: StoredImage[];
  likes: LikeRow[];
}

/** 開発用ユーザーの固定 ID（テストと /api/dev/login で使う） */
export const SEED_USER_IDS = {
  userA: "a0000000-0000-4000-8000-000000000001",
  userB: "a0000000-0000-4000-8000-000000000002",
  admin: "a0000000-0000-4000-8000-000000000003",
} as const;

export const SEED_USER_ID_LIST: readonly string[] = [
  SEED_USER_IDS.userA,
  SEED_USER_IDS.userB,
  SEED_USER_IDS.admin,
];

const SEED_PROFILE_CREATED_AT = "2026-04-01T09:00:00.000+09:00";

const SEED_PROFILES: Profile[] = [
  {
    id: SEED_USER_IDS.userA,
    displayName: "開発ユーザーA",
    avatarUrl: null,
    isAdmin: false,
    createdAt: SEED_PROFILE_CREATED_AT,
  },
  {
    id: SEED_USER_IDS.userB,
    displayName: "開発ユーザーB",
    avatarUrl: null,
    isAdmin: false,
    createdAt: SEED_PROFILE_CREATED_AT,
  },
  {
    id: SEED_USER_IDS.admin,
    displayName: "管理者ユーザー",
    avatarUrl: null,
    isAdmin: true,
    createdAt: SEED_PROFILE_CREATED_AT,
  },
];

/** 投稿時刻の傾向。配列から一様に選ぶことで重みを付ける */
const HOUR_PROFILE_NAMES = ["morning", "day", "evening", "night", "lunch"] as const;
type HourProfile = (typeof HOUR_PROFILE_NAMES)[number];
const HOUR_PROFILES: Record<HourProfile, number[]> = {
  morning: [6, 7, 7, 7, 8, 8, 8, 9, 9, 10, 11, 15],
  day: [9, 10, 10, 11, 11, 12, 13, 13, 14, 14, 15, 15, 16, 17],
  evening: [12, 14, 15, 16, 16, 17, 17, 17, 18, 18, 18, 19],
  night: [17, 18, 19, 19, 20, 20, 20, 21, 21, 22],
  lunch: [10, 11, 11, 12, 12, 12, 13, 13, 14, 15],
};

/** 滞在時間の傾向（spots.json の stayDefault から決める） */
const STAY_PROFILES: Record<StayDuration, (StayDuration | null)[]> = {
  lt30: ["lt30", "lt30", "lt30", "lt60", null],
  lt60: ["lt60", "lt60", "lt60", "lt30", "lt120", null],
  lt120: ["lt120", "lt120", "lt60", "lt120", "half_day", null],
  half_day: ["half_day", "half_day", "lt120", "lt120", null],
};

/** 投稿カテゴリのゆらぎ（スポットのカテゴリと違うものを少数混ぜる） */
const ALT_CATEGORY: Record<Category, Category> = {
  nature: "photogenic",
  gourmet: "other",
  history: "photogenic",
  photogenic: "nature",
  other: "photogenic",
};

/** カテゴリ共通のコメント（スポット固有のコメントを使い切ったあとに使う） */
const GENERIC_COMMENTS: Record<Category, string[]> = {
  nature: [
    "午前中は光がやわらかくて散策にちょうどいいです",
    "雨上がりは緑が濃くなってきれいでした",
    "歩きやすい靴で来るのがおすすめです",
    "ベンチが少ないので休憩は早めに取るのがよさそう",
    "季節で表情が変わるので何度来ても楽しめます",
    "冬は足元が凍るので滑りにくい靴があると安心です",
  ],
  gourmet: [
    "昼どきは行列になるので開店直後が狙い目です",
    "現金しか使えない店があるので小銭を用意しておくと安心",
    "食べ歩きは店の前で食べるのがマナーです",
    "夕方には売り切れるものが多いので早めに",
    "一人でも入りやすい雰囲気でした",
  ],
  history: [
    "拝観受付は閉まるのが早いので時間に注意",
    "御朱印は混む前の午前中がスムーズです",
    "音声ガイドを借りると見どころが分かりやすいです",
    "紅葉の時期は入場まで30分ほど待ちました",
    "庭園をゆっくり見るなら1時間は見ておいた方がいいです",
    "団体客が来る前の朝が静かでおすすめです",
  ],
  photogenic: [
    "逆光になりにくい午後が撮りやすかったです",
    "三脚は使えないので手持ちで撮りました",
    "人が入らない構図を狙うなら早朝一択です",
    "雨の日は反射が入ってむしろ良い写真が撮れます",
    "夕暮れの30分だけ空の色が特別です",
  ],
  other: [
    "トイレは入口近くにあります",
    "コインロッカーがあるので荷物を預けてから回れます",
    "休日は混むので平日の方が落ち着いて楽しめます",
    "屋根があるので雨の日の予定にも入れやすいです",
  ],
};

// ---------- seed-data/kanazawa/spots.json ----------

/** spots.json の 1 件（写真取得ツール用の commons などは seed では使わない） */
export interface SpotSeed {
  key: string;
  name: string;
  lat: number;
  lng: number;
  category: Category;
  address: string;
  prefecture: string;
  city: string;
  stayDefault: StayDuration;
  postCountTarget: number;
  hourProfile: HourProfile;
  comments: string[];
  verified: boolean;
  note?: string;
}

function isOneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === "string" && (list as readonly string[]).includes(v);
}

/** JSON の 1 件を検証して SpotSeed にする。形が違えば例外（seed の不備を起動時に気づけるように） */
function parseSpotSeed(raw: unknown, index: number): SpotSeed {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const fail = (field: string): never => {
    throw new Error(
      `seed-data/kanazawa/spots.json [${index}] (${String(r.key ?? "?")}): ${field} が不正です`,
    );
  };
  if (typeof r.key !== "string" || !/^[a-z0-9-]+$/.test(r.key)) fail("key");
  if (typeof r.name !== "string" || r.name.length === 0 || r.name.length > 50) fail("name");
  if (typeof r.lat !== "number" || typeof r.lng !== "number") fail("lat/lng");
  if (!isOneOf(CATEGORIES, r.category)) fail("category");
  if (typeof r.address !== "string") fail("address");
  if (typeof r.prefecture !== "string" || typeof r.city !== "string") fail("prefecture/city");
  if (!isOneOf(STAY_DURATIONS, r.stayDefault)) fail("stayDefault");
  if (typeof r.postCountTarget !== "number" || r.postCountTarget < 1 || r.postCountTarget > 25)
    fail("postCountTarget");
  if (!isOneOf(HOUR_PROFILE_NAMES, r.hourProfile)) fail("hourProfile");
  if (!Array.isArray(r.comments) || r.comments.some((c) => typeof c !== "string")) fail("comments");
  return {
    key: r.key as string,
    name: r.name as string,
    lat: r.lat as number,
    lng: r.lng as number,
    category: r.category as Category,
    address: r.address as string,
    prefecture: r.prefecture as string,
    city: r.city as string,
    stayDefault: r.stayDefault as StayDuration,
    postCountTarget: r.postCountTarget as number,
    hourProfile: r.hourProfile as HourProfile,
    comments: r.comments as string[],
    verified: r.verified === true,
    ...(typeof r.note === "string" ? { note: r.note } : {}),
  };
}

/** spots.json の全件（並び順 = スポット UUID の末尾番号） */
export const SPOT_SEEDS: readonly SpotSeed[] = (spotsJson as unknown[]).map(parseSpotSeed);

// ---------- seed-data/kanazawa/photos.json ----------

export type PhotoSeason = "winter" | "spring" | "summer" | "autumn";
export type PhotoTimeOfDay = "day" | "night";

/** photos.json の 1 件（写真取得ツールが生成する） */
export interface SeedPhoto {
  spotKey: string;
  file: string;
  fullPath: string;
  thumbPath: string;
  width: number;
  height: number;
  title: string;
  author: string;
  license: string;
  licenseUrl: string;
  sourceUrl: string;
  season: PhotoSeason | null;
  timeOfDay: PhotoTimeOfDay | null;
}

const SEASONS = ["winter", "spring", "summer", "autumn"] as const;
const TIMES_OF_DAY = ["day", "night"] as const;

/** 形が違う行は捨てる（写真が無い状態でも seed が動くことを優先する） */
function parseSeedPhoto(raw: unknown): SeedPhoto | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.spotKey !== "string" || typeof r.fullPath !== "string" || typeof r.thumbPath !== "string") {
    return null;
  }
  if (!r.fullPath.startsWith("seed/photos/") || !r.thumbPath.startsWith("seed/photos/")) return null;
  const width = typeof r.width === "number" && r.width > 0 ? Math.round(r.width) : 1600;
  const height = typeof r.height === "number" && r.height > 0 ? Math.round(r.height) : 1067;
  return {
    spotKey: r.spotKey,
    file: typeof r.file === "string" ? r.file : r.fullPath,
    fullPath: r.fullPath,
    thumbPath: r.thumbPath,
    width,
    height,
    title: typeof r.title === "string" ? r.title : "",
    author: typeof r.author === "string" ? r.author : "",
    license: typeof r.license === "string" ? r.license : "",
    licenseUrl: typeof r.licenseUrl === "string" ? r.licenseUrl : "",
    sourceUrl: typeof r.sourceUrl === "string" ? r.sourceUrl : "",
    season: isOneOf(SEASONS, r.season) ? r.season : null,
    timeOfDay: isOneOf(TIMES_OF_DAY, r.timeOfDay) ? r.timeOfDay : null,
  };
}

/** photos.json の全件（無効な行は除く）。ファイルが空配列なら [] */
export const SEED_PHOTOS: readonly SeedPhoto[] = (Array.isArray(photosJson) ? (photosJson as unknown[]) : [])
  .map(parseSeedPhoto)
  .filter((p): p is SeedPhoto => p !== null);

function photosBySpotKey(): Map<string, SeedPhoto[]> {
  const map = new Map<string, SeedPhoto[]>();
  for (const p of SEED_PHOTOS) {
    const list = map.get(p.spotKey) ?? [];
    list.push(p);
    map.set(p.spotKey, list);
  }
  return map;
}

// ---------- 決定的な乱数・ID・日時 ----------

/** 固定シードの疑似乱数（mulberry32） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length)];
}

function hex(n: number, width: number): string {
  return n.toString(16).padStart(width, "0");
}

/** 決定的な UUID（version 4 / variant 8 の形式を満たす） */
export function seedUuid(kind: "spot" | "post" | "image", n: number): string {
  const prefix = kind === "spot" ? "b0000000" : kind === "post" ? "c0000000" : "d0000000";
  return `${prefix}-0000-4000-8000-${hex(n, 12)}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** UTC の日付（年月日）から dayOffset 日後の日付文字列 */
function dateFrom(year: number, monthIndex: number, day: number, dayOffset: number): string {
  const d = new Date(Date.UTC(year, monthIndex, day) + dayOffset * 86_400_000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * 投稿日時の範囲。既定は 2026-04-01〜2026-10-09（192 日）。
 * 写真に季節があればその季節の範囲に合わせる（秋は前年 11 月、冬は 1〜2 月など。未来の日付は作らない）。
 */
const DATE_RANGES: Record<
  PhotoSeason | "default",
  { year: number; month: number; day: number; days: number }
> = {
  default: { year: 2026, month: 3, day: 1, days: 192 },
  winter: { year: 2026, month: 0, day: 10, days: 50 },
  spring: { year: 2026, month: 2, day: 25, days: 27 },
  summer: { year: 2026, month: 6, day: 1, days: 62 },
  autumn: { year: 2025, month: 10, day: 1, days: 30 },
};

/** 投稿日時を作る（日本時間）。写真の季節・時間帯があればそれに合わせる */
function seedCreatedAt(
  rng: () => number,
  hours: HourProfile,
  season: PhotoSeason | null,
  timeOfDay: PhotoTimeOfDay | null,
): string {
  const range = DATE_RANGES[season ?? "default"];
  const date = dateFrom(range.year, range.month, range.day, Math.floor(rng() * range.days));
  let hour = pick(rng, HOUR_PROFILES[hours]);
  if (timeOfDay === "night") hour = 18 + Math.floor(rng() * 4);
  else if (timeOfDay === "day") hour = 7 + Math.floor(rng() * 11);
  const minute = Math.floor(rng() * 60);
  const second = Math.floor(rng() * 60);
  return `${date}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}.000+09:00`;
}

/** コメント本文の上限（F-2-8） */
const COMMENT_MAX = 150;
const AUTHOR_MAX = 30;

/** 写真付きの投稿はコメント末尾にライセンス表示を付ける（150 文字以内に収める） */
export function withPhotoCredit(comment: string, photo: Pick<SeedPhoto, "author" | "license">): string {
  const author = photo.author.trim() || "不明";
  const license = photo.license.trim();
  const shortAuthor =
    [...author].length > AUTHOR_MAX ? `${[...author].slice(0, AUTHOR_MAX - 1).join("")}…` : author;
  const credit = license ? `写真: ${shortAuthor}（${license}）` : `写真: ${shortAuthor}`;
  const room = COMMENT_MAX - [...credit].length - 1;
  if (room <= 0) return [...credit].slice(0, COMMENT_MAX).join("");
  const body = [...comment].length > room ? [...comment].slice(0, room).join("") : comment;
  return body ? `${body}\n${credit}` : credit;
}

/** 初期データを生成する（決定的） */
export function buildSeedData(): SeedData {
  const rng = mulberry32(20261010);
  const profiles = SEED_PROFILES.map((p) => ({ ...p }));
  const spots: Spot[] = [];
  const posts: Post[] = [];
  const images: StoredImage[] = [];
  const likes: LikeRow[] = [];
  const userIds = [
    SEED_USER_IDS.userA,
    SEED_USER_IDS.userA,
    SEED_USER_IDS.userB,
    SEED_USER_IDS.userB,
    SEED_USER_IDS.admin,
  ];
  const photoMap = photosBySpotKey();

  let postSeq = 1;
  let imageSeq = 1;

  SPOT_SEEDS.forEach((seed, spotIndex) => {
    const spotId = seedUuid("spot", spotIndex + 1);
    const comments = [...seed.comments, ...GENERIC_COMMENTS[seed.category]];
    const photos = photoMap.get(seed.key) ?? [];
    const spotPosts: Post[] = [];
    const imagesByPost = new Map<string, StoredImage[]>();
    let imageNo = 1;
    let photoCursor = 0;

    for (let i = 0; i < seed.postCountTarget; i += 1) {
      const postId = seedUuid("post", postSeq);
      postSeq += 1;
      const userId = pick(rng, userIds);
      const category: Category = rng() < 0.08 ? ALT_CATEGORY[seed.category] : seed.category;
      const stayDuration = pick(rng, STAY_PROFILES[seed.stayDefault]);

      // 画像：写真があれば 1〜2 枚を順番に割り当て（足りなければ使い回す）。無ければプレースホルダー SVG
      const postImages: StoredImage[] = [];
      const postPhotos: SeedPhoto[] = [];
      if (photos.length > 0) {
        const count = Math.min(photos.length, 1 + (rng() < 0.35 ? 1 : 0));
        for (let k = 0; k < count; k += 1) {
          postPhotos.push(photos[photoCursor % photos.length]);
          photoCursor += 1;
        }
      } else {
        const count = 1 + (rng() < 0.35 ? 1 : 0) + (rng() < 0.15 ? 1 : 0);
        for (let k = 0; k < count; k += 1) {
          postImages.push({
            id: seedUuid("image", imageSeq),
            postId,
            fullPath: `seed/${spotId}/${imageNo}.svg`,
            thumbPath: `seed/${spotId}/${imageNo}_t.svg`,
            width: 1600,
            height: 1200,
            sortOrder: k,
          });
          imageSeq += 1;
          imageNo += 1;
        }
      }
      for (const [k, photo] of postPhotos.entries()) {
        postImages.push({
          id: seedUuid("image", imageSeq),
          postId,
          fullPath: photo.fullPath,
          thumbPath: photo.thumbPath,
          width: photo.width,
          height: photo.height,
          sortOrder: k,
        });
        imageSeq += 1;
      }
      const lead = postPhotos[0] ?? null;

      const createdAt = seedCreatedAt(rng, seed.hourProfile, lead?.season ?? null, lead?.timeOfDay ?? null);
      const baseComment = comments[i % comments.length];
      const post: Post = {
        id: postId,
        userId,
        spotId,
        comment: lead ? withPhotoCredit(baseComment, lead) : baseComment,
        category,
        stayDuration,
        likeCount: 0,
        status: "public",
        createdAt,
        updatedAt: createdAt,
      };
      images.push(...postImages);
      imagesByPost.set(postId, postImages);

      // いいね：投稿者以外のユーザーが一定確率で付ける。人気スポットほど付きやすい
      const likeProb = seed.postCountTarget >= 10 ? 0.55 : 0.3;
      for (const liker of SEED_USER_ID_LIST) {
        if (liker === userId) continue;
        if (rng() < likeProb) {
          likes.push({ userId: liker, postId, createdAt });
          post.likeCount += 1;
        }
      }

      spotPosts.push(post);
      posts.push(post);
    }

    const firstPost = [...spotPosts].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    const base: Spot = {
      id: spotId,
      name: seed.name,
      lat: seed.lat,
      lng: seed.lng,
      address: seed.address,
      prefecture: seed.prefecture,
      city: seed.city,
      category: seed.category,
      source: "gps",
      externalRef: null,
      postCount: 0,
      likeCount: 0,
      coverImageId: null,
      stayMinutesMedian: null,
      hourHistogram: new Array<number>(24).fill(0),
      openingHours: null,
      createdBy: firstPost?.userId ?? SEED_USER_IDS.userA,
      createdAt: firstPost?.createdAt ?? SEED_PROFILE_CREATED_AT,
    };
    spots.push(computeSpotStats(base, spotPosts, (postId) => imagesByPost.get(postId) ?? []));
  });

  return { profiles, spots, posts, images, likes };
}

/** seed のスポット名とカテゴリ（/api/dev/files のプレースホルダー画像用。削除後も名前を出せるように） */
export function seedSpotInfo(spotId: string): { name: string; category: Category } | null {
  const m = /^b0000000-0000-4000-8000-([0-9a-f]{12})$/.exec(spotId);
  if (!m) return null;
  const seed = SPOT_SEEDS[parseInt(m[1], 16) - 1];
  return seed ? { name: seed.name, category: seed.category } : null;
}
