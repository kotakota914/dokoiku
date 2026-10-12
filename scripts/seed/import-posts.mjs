#!/usr/bin/env node
/**
 * チームが撮った写真を一覧表（CSV）に従って投稿として一括取り込みする。
 *
 * 使い方（リポジトリ直下で実行。Node 20 以上）:
 *   node scripts/seed/import-posts.mjs --photos ./my-photos --csv ./my-photos/list.csv
 *   node scripts/seed/import-posts.mjs --photos ./my-photos --csv ./my-photos/list.csv --dry-run
 *   node scripts/seed/import-posts.mjs --photos ./my-photos --csv ./my-photos/list.csv --target supabase --user <profiles.id>
 *
 * CSV（UTF-8、ヘッダー行あり。テンプレートは seed-data/import-template.csv）:
 *   file,spot,category,stay,comment,lat,lng,taken_at
 *   file     : 写真ファイル名（--photos のフォルダからの相対パス）
 *   spot     : 既存スポット名（seed の name と一致）または新規スポット名（1〜50 文字）
 *   category : nature | gourmet | history | photogenic | other
 *   stay     : lt30 | lt60 | lt120 | half_day | 空
 *   comment  : 150 文字以内（空でも可）
 *   lat,lng  : 空なら写真の EXIF（GPS）→ 既存スポットの座標 の順に補う。新規スポットで EXIF も無ければ必須
 *   taken_at : 撮影日時（ISO 8601、例 2026-10-05T14:30:00+09:00）。空なら EXIF の撮影日時
 *              memory では投稿時刻は API が付けるため参考情報。supabase では posts.created_at に入れる
 *
 * 取り込み先（--target）:
 *   memory（既定）: ローカルで起動中のアプリ（--base-url 既定 http://localhost:3000）に
 *                   POST /api/dev/login → POST /api/v1/uploads → PUT 署名付き URL → POST /api/v1/posts の順で送る。
 *                   --user は開発ユーザーの ID（既定 開発ユーザーA）。
 *   supabase       : 環境変数 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY を使い service role で
 *                   Storage（post-images）と spots / posts / post_images に直接書き込む。--user は profiles.id（必須）。
 *
 * その他: --dry-run（変換と検証だけ行い、送信しない）、--base-url <url>
 * 写真は sharp で長辺 1600 / 400 の WebP に変換し、EXIF は除去される。
 */
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..", "..");

export const CATEGORIES = ["nature", "gourmet", "history", "photogenic", "other"];
export const STAY_DURATIONS = ["lt30", "lt60", "lt120", "half_day"];
/** src/lib/repo/memory/seed.ts の SEED_USER_IDS.userA */
export const DEFAULT_DEV_USER_ID = "a0000000-0000-4000-8000-000000000001";
const DEV_USER_COOKIE = "dokoiko_dev_user";
const COMMENT_MAX = 150;
const SPOT_NAME_MAX = 50;
const CONVERTED_MAX_BYTES = 2 * 1024 * 1024;
const BUCKET = "post-images";

// ---------- 純粋関数（テスト対象） ----------

/** RFC 4180 風の CSV を解析する。BOM、CRLF、引用符内の改行・カンマ・"" に対応 */
export function parseCsv(text) {
  const src = String(text).replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (nonEmpty.length === 0) return [];
  const header = nonEmpty[0].map((h) => h.trim().toLowerCase());
  return nonEmpty.slice(1).map((r, idx) => {
    const obj = { _line: idx + 2 };
    header.forEach((h, i) => {
      obj[h] = (r[i] ?? "").trim();
    });
    return obj;
  });
}

const REQUIRED_COLUMNS = ["file", "spot", "category"];

/** 1 行を検証して正規化する。エラーがあれば { errors: string[] } */
export function validateRow(row) {
  const errors = [];
  for (const c of REQUIRED_COLUMNS) if (!row[c]) errors.push(`${c} が空です`);
  if (row.spot && row.spot.length > SPOT_NAME_MAX)
    errors.push(`spot は ${SPOT_NAME_MAX} 文字以内にしてください`);
  if (row.category && !CATEGORIES.includes(row.category)) errors.push(`category が不正です: ${row.category}`);
  const stay = row.stay || null;
  if (stay && !STAY_DURATIONS.includes(stay)) errors.push(`stay が不正です: ${row.stay}`);
  const comment = row.comment ?? "";
  if (comment.length > COMMENT_MAX) errors.push(`comment は ${COMMENT_MAX} 文字以内にしてください`);
  const lat = row.lat ? Number(row.lat) : null;
  const lng = row.lng ? Number(row.lng) : null;
  if (lat !== null && !(Number.isFinite(lat) && lat >= -90 && lat <= 90))
    errors.push(`lat が不正です: ${row.lat}`);
  if (lng !== null && !(Number.isFinite(lng) && lng >= -180 && lng <= 180))
    errors.push(`lng が不正です: ${row.lng}`);
  if ((lat === null) !== (lng === null)) errors.push("lat と lng は両方指定してください");
  let takenAt = null;
  if (row.taken_at) {
    const d = new Date(row.taken_at);
    if (Number.isNaN(d.getTime())) errors.push(`taken_at が不正です: ${row.taken_at}`);
    else takenAt = d.toISOString();
  }
  if (errors.length > 0) return { errors };
  return {
    file: row.file,
    spot: row.spot,
    category: row.category,
    stayDuration: stay,
    comment,
    lat,
    lng,
    takenAt,
    line: row._line,
  };
}

/**
 * 座標の決定: CSV → EXIF → 既存スポット。
 * @param {{lat:number|null,lng:number|null}} row
 * @param {{latitude?:number,longitude?:number}|null} exif
 * @param {{lat:number,lng:number}|null} existingSpot
 * @returns {{lat:number,lng:number,from:"csv"|"exif"|"spot"} | null}
 */
export function resolveLocation(row, exif, existingSpot) {
  if (row.lat !== null && row.lat !== undefined && row.lng !== null && row.lng !== undefined) {
    return { lat: row.lat, lng: row.lng, from: "csv" };
  }
  if (exif && Number.isFinite(exif.latitude) && Number.isFinite(exif.longitude)) {
    return { lat: exif.latitude, lng: exif.longitude, from: "exif" };
  }
  if (existingSpot) return { lat: existingSpot.lat, lng: existingSpot.lng, from: "spot" };
  return null;
}

/** 撮影日時の決定: CSV → EXIF（DateTimeOriginal）。無ければ null */
export function resolveTakenAt(row, exif) {
  if (row.takenAt) return row.takenAt;
  const d = exif?.DateTimeOriginal ?? exif?.CreateDate ?? null;
  if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toISOString();
  if (typeof d === "string") {
    const parsed = new Date(d.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3"));
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

export function parseArgs(argv) {
  const out = {
    photos: null,
    csv: null,
    target: "memory",
    baseUrl: "http://localhost:3000",
    user: null,
    dryRun: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const take = () => argv[++i];
    if (a === "--photos") out.photos = take();
    else if (a === "--csv") out.csv = take();
    else if (a === "--target") out.target = take();
    else if (a === "--base-url") out.baseUrl = take();
    else if (a === "--user") out.user = take();
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a.startsWith("--") && a.includes("=")) {
      const [k, v] = a.slice(2).split(/=(.*)/s);
      const key = { photos: "photos", csv: "csv", target: "target", "base-url": "baseUrl", user: "user" }[k];
      if (!key) throw new Error(`不明なオプションです: ${a}`);
      out[key] = v;
    } else throw new Error(`不明なオプションです: ${a}`);
  }
  if (!out.help) {
    if (!out.photos) throw new Error("--photos <写真フォルダ> を指定してください");
    if (!out.csv) throw new Error("--csv <一覧表 CSV> を指定してください");
    if (!["memory", "supabase"].includes(out.target)) throw new Error("--target は memory か supabase です");
    if (out.target === "memory" && !out.user) out.user = DEFAULT_DEV_USER_ID;
    if (out.target === "supabase" && !out.user)
      throw new Error("--target supabase では --user <profiles.id> が必要です");
    out.baseUrl = out.baseUrl.replace(/\/+$/, "");
  }
  return out;
}

// ---------- 画像 ----------

async function loadSharp() {
  const mod = await import("sharp");
  return mod.default ?? mod;
}

async function readExif(buffer) {
  try {
    const mod = await import("exifr");
    const exifr = mod.default ?? mod;
    const data = await exifr.parse(buffer, {
      gps: true,
      exif: true,
      pick: [
        "DateTimeOriginal",
        "CreateDate",
        "GPSLatitude",
        "GPSLongitude",
        "GPSLatitudeRef",
        "GPSLongitudeRef",
      ],
    });
    return data ?? null;
  } catch {
    return null;
  }
}

/** 1600 / 400 の WebP（EXIF なし）を作る */
export async function convertImage(buffer) {
  const sharp = await loadSharp();
  const full = await sharp(buffer)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
  const thumb = await sharp(buffer)
    .rotate()
    .resize({ width: 400, height: 400, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer({ resolveWithObject: true });
  if (full.data.byteLength > CONVERTED_MAX_BYTES) {
    throw new Error(`変換後の画像が 2MB を超えています（${full.data.byteLength} bytes）`);
  }
  return {
    full: full.data,
    thumb: thumb.data,
    width: full.info.width,
    height: full.info.height,
  };
}

// ---------- memory（API 経由） ----------

function apiErrorMessage(body, status) {
  const err = body?.error;
  if (!err) return `HTTP ${status}`;
  const details = Array.isArray(err.details) ? ` ${JSON.stringify(err.details)}` : "";
  return `${err.code ?? status}: ${err.message ?? ""}${details}`;
}

function createApiClient(baseUrl) {
  let cookie = "";
  async function call(method, pathname, body, extraHeaders = {}) {
    const headers = { Accept: "application/json", ...extraHeaders };
    if (cookie) headers.Cookie = cookie;
    let payload = body;
    if (body && !(body instanceof Uint8Array)) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${baseUrl}${pathname}`, { method, headers, body: payload });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      const m = new RegExp(`${DEV_USER_COOKIE}=([^;]+)`).exec(setCookie);
      if (m) cookie = `${DEV_USER_COOKIE}=${m[1]}`;
    }
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { res, json };
  }
  return {
    async login(userId) {
      const { res, json } = await call("POST", "/api/dev/login", { userId });
      if (!res.ok) throw new Error(`開発用ログインに失敗: ${apiErrorMessage(json, res.status)}`);
      if (!cookie) throw new Error("ログイン Cookie を受け取れませんでした");
      return json.profile;
    },
    async findSpotByName(name) {
      const { res, json } = await call("GET", `/api/v1/places/search?q=${encodeURIComponent(name)}`);
      if (!res.ok) throw new Error(`スポット検索に失敗: ${apiErrorMessage(json, res.status)}`);
      const results = (json?.results ?? []).filter((r) => r.source === "db");
      return results.find((r) => r.name === name) ?? results.find((r) => r.name.includes(name)) ?? null;
    },
    async upload(image) {
      const { res, json } = await call("POST", "/api/v1/uploads", {
        files: [
          { kind: "full", contentType: "image/webp", size: image.full.byteLength },
          { kind: "thumb", contentType: "image/webp", size: image.thumb.byteLength },
        ],
      });
      if (!res.ok) throw new Error(`アップロード先の発行に失敗: ${apiErrorMessage(json, res.status)}`);
      const uploads = json.uploads;
      const full = uploads.find((u) => u.kind === "full");
      const thumb = uploads.find((u) => u.kind === "thumb");
      for (const [target, data] of [
        [full, image.full],
        [thumb, image.thumb],
      ]) {
        const url = target.signedUrl.startsWith("/") ? `${baseUrl}${target.signedUrl}` : target.signedUrl;
        const headers = { "Content-Type": "image/webp" };
        if (url.startsWith(baseUrl) && cookie) headers.Cookie = cookie;
        const put = await fetch(url, { method: "PUT", headers, body: data });
        if (!put.ok) throw new Error(`画像の PUT に失敗（${put.status}）: ${target.path}`);
      }
      return { fullPath: full.path, thumbPath: thumb.path, width: image.width, height: image.height };
    },
    async createPost(body) {
      const { res, json } = await call("POST", "/api/v1/posts", body);
      if (
        res.status === 409 &&
        Array.isArray(json?.error?.details?.candidates) &&
        json.error.details.candidates[0]
      ) {
        // 同じ場所に似た名前のスポットがある。既存スポットへ投稿し直す
        const candidate = json.error.details.candidates[0];
        const retry = await call("POST", "/api/v1/posts", {
          ...body,
          newSpot: undefined,
          spotId: candidate.id,
        });
        if (!retry.res.ok) throw new Error(`投稿に失敗: ${apiErrorMessage(retry.json, retry.res.status)}`);
        return { ...retry.json, reusedSpot: candidate.name };
      }
      if (!res.ok) throw new Error(`投稿に失敗: ${apiErrorMessage(json, res.status)}`);
      return json;
    },
  };
}

async function importToMemory(rows, args, loadImage) {
  const api = createApiClient(args.baseUrl);
  const profile = await api.login(args.user);
  console.log(`ログイン: ${profile.displayName}（${args.user}）`);
  const results = [];
  for (const row of rows) {
    const label = `${row.file}（${row.line} 行目）`;
    try {
      const { image, exif } = await loadImage(row);
      const existing = await api.findSpotByName(row.spot);
      const loc = resolveLocation(row, exif, existing);
      if (!existing && !loc)
        throw new Error("新規スポットには lat/lng が必要です（EXIF に GPS がありません）");
      const uploaded = await api.upload(image);
      const body = {
        images: [uploaded],
        comment: row.comment,
        category: row.category,
        stayDuration: row.stayDuration,
      };
      if (existing) body.spotId = existing.id;
      else body.newSpot = { name: row.spot, lat: loc.lat, lng: loc.lng, source: "gps", accuracyM: 10 };
      const created = await api.createPost(body);
      const note = existing
        ? `既存スポット「${existing.name}」`
        : created.reusedSpot
          ? `既存スポット「${created.reusedSpot}」（重複判定）`
          : `新規スポット「${row.spot}」（座標: ${loc.from}）`;
      console.log(`  OK ${label} → ${note} post=${created.post?.id ?? "?"}`);
      results.push({ ok: true, file: row.file });
    } catch (e) {
      console.log(`  NG ${label}: ${e.message}`);
      results.push({ ok: false, file: row.file, reason: e.message });
    }
  }
  return results;
}

// ---------- supabase（service role） ----------

async function importToSupabase(rows, args, loadImage) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定してください");
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const profile = await sb.from("profiles").select("id, display_name").eq("id", args.user).maybeSingle();
  if (profile.error) throw new Error(`profiles の確認に失敗: ${profile.error.message}`);
  if (!profile.data)
    throw new Error(
      `profiles に ${args.user} がありません（先に Google ログインして profile を作ってください）`,
    );
  console.log(`投稿者: ${profile.data.display_name}（${args.user}）`);

  const results = [];
  const touchedSpots = new Set();
  for (const row of rows) {
    const label = `${row.file}（${row.line} 行目）`;
    try {
      const { image, exif } = await loadImage(row);
      const found = await sb
        .from("spots")
        .select("id, name, location")
        .eq("name", row.spot)
        .limit(1)
        .maybeSingle();
      if (found.error) throw new Error(`spots の検索に失敗: ${found.error.message}`);
      let spotId = found.data?.id ?? null;
      let note;
      if (!spotId) {
        const loc = resolveLocation(row, exif, null);
        if (!loc) throw new Error("新規スポットには lat/lng が必要です（EXIF に GPS がありません）");
        const ins = await sb
          .from("spots")
          .insert({
            name: row.spot,
            location: `SRID=4326;POINT(${loc.lng} ${loc.lat})`,
            category: row.category,
            source: "gps",
            created_by: args.user,
          })
          .select("id")
          .single();
        if (ins.error) throw new Error(`spots の作成に失敗: ${ins.error.message}`);
        spotId = ins.data.id;
        note = `新規スポット「${row.spot}」（座標: ${loc.from}）`;
      } else {
        note = `既存スポット「${found.data.name}」`;
      }

      const takenAt = resolveTakenAt(row, exif);
      const postValues = {
        user_id: args.user,
        spot_id: spotId,
        comment: row.comment,
        category: row.category,
        stay_duration: row.stayDuration,
        status: "public",
      };
      if (takenAt) {
        postValues.created_at = takenAt;
        postValues.updated_at = takenAt;
      }
      const post = await sb.from("posts").insert(postValues).select("id").single();
      if (post.error) throw new Error(`posts の作成に失敗: ${post.error.message}`);
      const postId = post.data.id;

      const imageId = crypto.randomUUID();
      const fullPath = `posts/${postId}/${imageId}.webp`;
      const thumbPath = `posts/${postId}/${imageId}_t.webp`;
      try {
        for (const [p, data] of [
          [fullPath, image.full],
          [thumbPath, image.thumb],
        ]) {
          const up = await sb.storage
            .from(BUCKET)
            .upload(p, data, { contentType: "image/webp", upsert: true });
          if (up.error) throw new Error(`Storage へのアップロードに失敗（${p}）: ${up.error.message}`);
        }
        const img = await sb.from("post_images").insert({
          id: imageId,
          post_id: postId,
          full_path: fullPath,
          thumb_path: thumbPath,
          width: image.width,
          height: image.height,
          sort_order: 0,
        });
        if (img.error) throw new Error(`post_images の作成に失敗: ${img.error.message}`);
      } catch (e) {
        await sb.from("posts").delete().eq("id", postId);
        await sb.storage.from(BUCKET).remove([fullPath, thumbPath]);
        throw e;
      }
      touchedSpots.add(spotId);
      console.log(`  OK ${label} → ${note} post=${postId}`);
      results.push({ ok: true, file: row.file });
    } catch (e) {
      console.log(`  NG ${label}: ${e.message}`);
      results.push({ ok: false, file: row.file, reason: e.message });
    }
  }
  for (const spotId of touchedSpots) {
    const r = await sb.rpc("recompute_spot_stats", { p_spot_id: spotId });
    if (r.error) console.log(`  統計の再計算に失敗（${spotId}）: ${r.error.message}`);
  }
  return results;
}

// ---------- main ----------

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(
      "使い方: node scripts/seed/import-posts.mjs --photos <フォルダ> --csv <CSV> [--target memory|supabase] [--user <id>] [--base-url <url>] [--dry-run]",
    );
    return 0;
  }
  const photosDir = path.resolve(args.photos);
  const csvPath = path.resolve(args.csv);
  const rawRows = parseCsv(await fsp.readFile(csvPath, "utf8"));
  if (rawRows.length === 0) {
    console.error("CSV に行がありません");
    return 1;
  }
  const rows = [];
  const invalid = [];
  for (const raw of rawRows) {
    const v = validateRow(raw);
    if (v.errors) invalid.push({ file: raw.file || `(${raw._line} 行目)`, reason: v.errors.join("、") });
    else rows.push(v);
  }
  console.log(
    `CSV: ${rows.length} 行（検証エラー ${invalid.length} 行）、取り込み先: ${args.target}${args.dryRun ? "（dry-run）" : ""}`,
  );

  const loadImage = async (row) => {
    const file = path.join(photosDir, row.file);
    let buffer;
    try {
      buffer = await fsp.readFile(file);
    } catch (e) {
      if (e.code === "ENOENT") throw new Error(`写真ファイルが見つかりません: ${file}`);
      throw e;
    }
    const exif = await readExif(buffer);
    const image = await convertImage(buffer);
    return { image, exif };
  };

  let results;
  if (args.dryRun) {
    results = [];
    for (const row of rows) {
      try {
        const { image, exif } = await loadImage(row);
        const loc = resolveLocation(row, exif, null);
        const takenAt = resolveTakenAt(row, exif);
        console.log(
          `  ${row.file}: ${image.width}x${image.height} ${(image.full.byteLength / 1024).toFixed(0)}KB spot="${row.spot}" ` +
            `座標=${loc ? `${loc.lat.toFixed(5)},${loc.lng.toFixed(5)}（${loc.from}）` : "なし（既存スポットなら可）"} 撮影=${takenAt ?? "不明"}`,
        );
        results.push({ ok: true, file: row.file });
      } catch (e) {
        console.log(`  NG ${row.file}: ${e.message}`);
        results.push({ ok: false, file: row.file, reason: e.message });
      }
    }
  } else if (args.target === "supabase") {
    results = await importToSupabase(rows, args, loadImage);
  } else {
    results = await importToMemory(rows, args, loadImage);
  }

  const failures = [...invalid, ...results.filter((r) => !r.ok)];
  const okCount = results.filter((r) => r.ok).length;
  console.log(`\n成功 ${okCount} 件、失敗 ${failures.length} 件`);
  if (failures.length > 0) {
    console.log("失敗の理由:");
    for (const f of failures) console.log(`  ${f.file}: ${f.reason}`);
  }
  return failures.length > 0 && okCount === 0 ? 1 : 0;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(e.message ?? e);
      process.exit(1);
    });
}
