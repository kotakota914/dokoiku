#!/usr/bin/env node
/**
 * supabase/seed.sql を seed-data/kanazawa/spots.json（と photos.json）から生成する。
 *
 *   node scripts/seed/generate-seed-sql.mjs            # supabase/seed.sql を書き出す
 *   node scripts/seed/generate-seed-sql.mjs --stdout   # 標準出力に出す
 *
 * - スポット・投稿・画像の ID は memory モード（src/lib/repo/memory/seed.ts）と同じ規則の固定 UUID
 *   （b0000000-… = spots.json の並び順、c0000000-… = 投稿、d0000000-… = 画像）。
 * - 投稿の内容・時刻・いいねは固定シードの疑似乱数で決める（seed.ts と同じ手順を JS で写したもの。
 *   seed.ts を変えたらこのファイルも合わせる）。
 * - 写真は photos.json の fullPath / thumbPath を使い、無いスポットは
 *   "seed/photos/<key>/<n>.webp" の予定パスにする（後で Storage に置く）。
 * - 何度流しても同じ結果になるよう on conflict do nothing にする。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SPOTS_FILE = path.join(ROOT, "seed-data", "kanazawa", "spots.json");
const PHOTOS_FILE = path.join(ROOT, "seed-data", "kanazawa", "photos.json");
const OUT_FILE = path.join(ROOT, "supabase", "seed.sql");

const CATEGORIES = ["nature", "gourmet", "history", "photogenic", "other"];
const STAY_DURATIONS = ["lt30", "lt60", "lt120", "half_day"];
const HOUR_PROFILE_NAMES = ["morning", "day", "evening", "night", "lunch"];

const SEED_USERS = [
  {
    id: "a0000000-0000-4000-8000-000000000001",
    email: "seed-user-a@example.com",
    name: "開発ユーザーA",
    admin: false,
  },
  {
    id: "a0000000-0000-4000-8000-000000000002",
    email: "seed-user-b@example.com",
    name: "開発ユーザーB",
    admin: false,
  },
  {
    id: "a0000000-0000-4000-8000-000000000003",
    email: "seed-admin@example.com",
    name: "管理者ユーザー",
    admin: true,
  },
];
const USER_IDS = SEED_USERS.map((u) => u.id);
/** 投稿者の重み（A・B が多め） */
const POSTER_POOL = [USER_IDS[0], USER_IDS[0], USER_IDS[1], USER_IDS[1], USER_IDS[2]];

const HOUR_PROFILES = {
  morning: [6, 7, 7, 7, 8, 8, 8, 9, 9, 10, 11, 15],
  day: [9, 10, 10, 11, 11, 12, 13, 13, 14, 14, 15, 15, 16, 17],
  evening: [12, 14, 15, 16, 16, 17, 17, 17, 18, 18, 18, 19],
  night: [17, 18, 19, 19, 20, 20, 20, 21, 21, 22],
  lunch: [10, 11, 11, 12, 12, 12, 13, 13, 14, 15],
};
const STAY_PROFILES = {
  lt30: ["lt30", "lt30", "lt30", "lt60", null],
  lt60: ["lt60", "lt60", "lt60", "lt30", "lt120", null],
  lt120: ["lt120", "lt120", "lt60", "lt120", "half_day", null],
  half_day: ["half_day", "half_day", "lt120", "lt120", null],
};
const ALT_CATEGORY = {
  nature: "photogenic",
  gourmet: "other",
  history: "photogenic",
  photogenic: "nature",
  other: "photogenic",
};
const GENERIC_COMMENTS = {
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
const DATE_RANGES = {
  default: { year: 2026, month: 3, day: 1, days: 192 },
  winter: { year: 2026, month: 0, day: 10, days: 50 },
  spring: { year: 2026, month: 2, day: 25, days: 27 },
  summer: { year: 2026, month: 6, day: 1, days: 62 },
  autumn: { year: 2025, month: 10, day: 1, days: 30 },
};
const COMMENT_MAX = 150;
const AUTHOR_MAX = 30;

// ---------- 入力 ----------

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadSpots() {
  const raw = readJson(SPOTS_FILE, null);
  if (!Array.isArray(raw) || raw.length === 0) throw new Error(`${SPOTS_FILE} が読めません`);
  return raw.map((r, i) => {
    const where = `spots.json [${i}] (${r?.key ?? "?"})`;
    if (typeof r.key !== "string" || !/^[a-z0-9-]+$/.test(r.key)) throw new Error(`${where}: key が不正です`);
    if (typeof r.name !== "string" || !r.name || r.name.length > 50)
      throw new Error(`${where}: name が不正です`);
    if (typeof r.lat !== "number" || typeof r.lng !== "number")
      throw new Error(`${where}: lat/lng が不正です`);
    if (!CATEGORIES.includes(r.category)) throw new Error(`${where}: category が不正です`);
    if (!STAY_DURATIONS.includes(r.stayDefault)) throw new Error(`${where}: stayDefault が不正です`);
    if (!HOUR_PROFILE_NAMES.includes(r.hourProfile)) throw new Error(`${where}: hourProfile が不正です`);
    if (!Number.isInteger(r.postCountTarget) || r.postCountTarget < 1 || r.postCountTarget > 25)
      throw new Error(`${where}: postCountTarget が不正です`);
    if (!Array.isArray(r.comments) || r.comments.some((c) => typeof c !== "string"))
      throw new Error(`${where}: comments が不正です`);
    return r;
  });
}

function loadPhotos() {
  const raw = readJson(PHOTOS_FILE, []);
  const map = new Map();
  if (!Array.isArray(raw)) return map;
  for (const p of raw) {
    if (
      !p ||
      typeof p.spotKey !== "string" ||
      typeof p.fullPath !== "string" ||
      typeof p.thumbPath !== "string"
    )
      continue;
    if (!p.fullPath.startsWith("seed/photos/") || !p.thumbPath.startsWith("seed/photos/")) continue;
    const list = map.get(p.spotKey) ?? [];
    list.push({
      fullPath: p.fullPath,
      thumbPath: p.thumbPath,
      width: Number.isFinite(p.width) && p.width > 0 ? Math.round(p.width) : 1600,
      height: Number.isFinite(p.height) && p.height > 0 ? Math.round(p.height) : 1067,
      author: typeof p.author === "string" ? p.author : "",
      license: typeof p.license === "string" ? p.license : "",
      season: ["winter", "spring", "summer", "autumn"].includes(p.season) ? p.season : null,
      timeOfDay: ["day", "night"].includes(p.timeOfDay) ? p.timeOfDay : null,
    });
    map.set(p.spotKey, list);
  }
  return map;
}

// ---------- 決定的な乱数・ID・日時（seed.ts と同じ） ----------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, list) => list[Math.floor(rng() * list.length)];
const pad2 = (n) => String(n).padStart(2, "0");

function seedUuid(kind, n) {
  const prefix = kind === "spot" ? "b0000000" : kind === "post" ? "c0000000" : "d0000000";
  return `${prefix}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

function dateFrom(year, monthIndex, day, dayOffset) {
  const d = new Date(Date.UTC(year, monthIndex, day) + dayOffset * 86_400_000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function seedCreatedAt(rng, hours, season, timeOfDay) {
  const range = DATE_RANGES[season ?? "default"];
  const date = dateFrom(range.year, range.month, range.day, Math.floor(rng() * range.days));
  let hour = pick(rng, HOUR_PROFILES[hours]);
  if (timeOfDay === "night") hour = 18 + Math.floor(rng() * 4);
  else if (timeOfDay === "day") hour = 7 + Math.floor(rng() * 11);
  const minute = Math.floor(rng() * 60);
  const second = Math.floor(rng() * 60);
  return `${date}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}+09:00`;
}

function withPhotoCredit(comment, photo) {
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

// ---------- 生成 ----------

function build(spotSeeds, photoMap) {
  const rng = mulberry32(20261010);
  const spots = [];
  const posts = [];
  const images = [];
  const likes = [];
  let postSeq = 1;
  let imageSeq = 1;

  spotSeeds.forEach((seed, spotIndex) => {
    const spotId = seedUuid("spot", spotIndex + 1);
    const comments = [...seed.comments, ...GENERIC_COMMENTS[seed.category]];
    const photos = photoMap.get(seed.key) ?? [];
    const spotPosts = [];
    let imageNo = 1;
    let photoCursor = 0;

    for (let i = 0; i < seed.postCountTarget; i += 1) {
      const postId = seedUuid("post", postSeq);
      postSeq += 1;
      const userId = pick(rng, POSTER_POOL);
      const category = rng() < 0.08 ? ALT_CATEGORY[seed.category] : seed.category;
      const stayDuration = pick(rng, STAY_PROFILES[seed.stayDefault]);

      const postImages = [];
      const postPhotos = [];
      if (photos.length > 0) {
        const count = Math.min(photos.length, 1 + (rng() < 0.35 ? 1 : 0));
        for (let k = 0; k < count; k += 1) {
          postPhotos.push(photos[photoCursor % photos.length]);
          photoCursor += 1;
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
      } else {
        // 写真がまだ無いスポット：後で Storage に置く予定のパス
        const count = 1 + (rng() < 0.35 ? 1 : 0) + (rng() < 0.15 ? 1 : 0);
        for (let k = 0; k < count; k += 1) {
          postImages.push({
            id: seedUuid("image", imageSeq),
            postId,
            fullPath: `seed/photos/${seed.key}/${imageNo}.webp`,
            thumbPath: `seed/photos/${seed.key}/${imageNo}_t.webp`,
            width: 1600,
            height: 1067,
            sortOrder: k,
          });
          imageSeq += 1;
          imageNo += 1;
        }
      }
      const lead = postPhotos[0] ?? null;
      const createdAt = seedCreatedAt(rng, seed.hourProfile, lead?.season ?? null, lead?.timeOfDay ?? null);
      const baseComment = comments[i % comments.length];
      const post = {
        id: postId,
        userId,
        spotId,
        comment: lead ? withPhotoCredit(baseComment, lead) : baseComment,
        category,
        stayDuration,
        createdAt,
      };
      images.push(...postImages);

      const likeProb = seed.postCountTarget >= 10 ? 0.55 : 0.3;
      for (const liker of USER_IDS) {
        if (liker === userId) continue;
        if (rng() < likeProb) likes.push({ userId: liker, postId, createdAt });
      }
      spotPosts.push(post);
      posts.push(post);
    }

    const first = [...spotPosts].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    spots.push({
      id: spotId,
      key: seed.key,
      name: seed.name,
      lat: seed.lat,
      lng: seed.lng,
      address: seed.address,
      prefecture: seed.prefecture,
      city: seed.city,
      category: seed.category,
      createdBy: first?.userId ?? USER_IDS[0],
      createdAt: first?.createdAt ?? "2026-04-01T09:00:00+09:00",
    });
  });

  return { spots, posts, images, likes };
}

// ---------- SQL ----------

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const qn = (s) => (s === null || s === undefined ? "null" : q(s));
const ts = (iso) => `timestamptz ${q(iso)}`;

function render(data) {
  const { spots, posts, images, likes } = data;
  const out = [];
  out.push(`-- =============================================================================
-- 開発用の初期データ（Q16：金沢市・野々市市 ${spots.length} スポット、金沢工業大学の学内スポットを含む）
-- このファイルは scripts/seed/generate-seed-sql.mjs が seed-data/kanazawa/spots.json から生成する。
-- 直接編集せず、spots.json / photos.json を直して再生成すること：
--   node scripts/seed/generate-seed-sql.mjs
-- 何度流しても同じ結果になるよう、ID は固定 UUID（memory モードと同じ）で on conflict do nothing にする。
-- 画像の実ファイルは写真取得ツールが public/seed/photos/<key>/<n>.webp に置き、
-- Supabase では同じパスで Storage（post-images バケット）に置く
-- （UI は読み込み失敗時にカテゴリアイコンで代替表示する）。
-- =============================================================================

begin;

-- ---------- 開発用ユーザー（memory モードの SEED_USER_IDS と同じ） ----------
-- profiles は auth.users と 1 対 1 なので、先に auth.users へ同じ UUID の行を入れる。
-- 列はローカル検証のスタブでも動くよう id, email, raw_user_meta_data に限る
insert into auth.users (id, email, raw_user_meta_data) values`);
  out.push(
    SEED_USERS.map(
      (u) => `  (${q(u.id)}, ${q(u.email)}, ${q(JSON.stringify({ full_name: u.name }))}::jsonb)`,
    ).join(",\n") + "\non conflict (id) do nothing;\n",
  );
  out.push(`insert into public.profiles (id, display_name, avatar_url, is_admin) values`);
  out.push(
    SEED_USERS.map((u) => `  (${q(u.id)}, ${q(u.name)}, null, ${u.admin})`).join(",\n") +
      "\non conflict (id) do nothing;\n",
  );

  out.push(`-- ---------- スポット（spots.json の並び順 = UUID 末尾） ----------
insert into public.spots (id, name, location, address, prefecture, city, category, source, created_by, created_at) values`);
  out.push(
    spots
      .map(
        (s) =>
          `  (${q(s.id)}, ${q(s.name)}, st_setsrid(st_makepoint(${s.lng}, ${s.lat}), 4326)::geography, ${qn(s.address)}, ${q(s.prefecture)}, ${q(s.city)}, ${q(s.category)}, 'gps', ${q(s.createdBy)}, ${ts(s.createdAt)})`,
      )
      .join(",\n") + "\non conflict (id) do nothing;\n",
  );

  out.push(`-- ---------- 投稿 ----------
insert into public.posts (id, user_id, spot_id, comment, category, stay_duration, status, created_at, updated_at) values`);
  out.push(
    posts
      .map(
        (p) =>
          `  (${q(p.id)}, ${q(p.userId)}, ${q(p.spotId)}, ${q(p.comment)}, ${q(p.category)}, ${qn(p.stayDuration)}, 'public', ${ts(p.createdAt)}, ${ts(p.createdAt)})`,
      )
      .join(",\n") + "\non conflict (id) do nothing;\n",
  );

  out.push(`-- ---------- 写真 ----------
insert into public.post_images (id, post_id, full_path, thumb_path, width, height, sort_order) values`);
  out.push(
    images
      .map(
        (i) =>
          `  (${q(i.id)}, ${q(i.postId)}, ${q(i.fullPath)}, ${q(i.thumbPath)}, ${i.width}, ${i.height}, ${i.sortOrder})`,
      )
      .join(",\n") + "\non conflict (id) do nothing;\n",
  );

  out.push(`-- ---------- いいね（トリガーで posts.like_count / spots.like_count が更新される） ----------
insert into public.likes (user_id, post_id, created_at) values`);
  out.push(
    likes.map((l) => `  (${q(l.userId)}, ${q(l.postId)}, ${ts(l.createdAt)})`).join(",\n") +
      "\non conflict (user_id, post_id) do nothing;\n",
  );

  out.push(`-- ---------- 統計の再計算（投稿数・代表写真・時間帯分布など） ----------
do $$
declare
  r record;
begin
  for r in select id from public.spots loop
    perform public.recompute_spot_stats(r.id);
  end loop;
end;
$$;

commit;
`);
  return out.join("\n");
}

function main() {
  const spotSeeds = loadSpots();
  const photoMap = loadPhotos();
  const data = build(spotSeeds, photoMap);
  const sql = render(data);
  if (process.argv.includes("--stdout")) {
    process.stdout.write(sql);
    return;
  }
  fs.writeFileSync(OUT_FILE, sql, "utf8");
  const withPhotos = data.spots.filter((s) => photoMap.has(s.key)).length;
  console.log(
    `${path.relative(ROOT, OUT_FILE)} を生成しました：スポット ${data.spots.length} 件、投稿 ${data.posts.length} 件、画像 ${data.images.length} 件、いいね ${data.likes.length} 件（写真あり ${withPhotos} スポット）`,
  );
}

main();
