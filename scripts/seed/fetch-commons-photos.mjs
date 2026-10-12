#!/usr/bin/env node
/**
 * Wikimedia Commons から自由ライセンスの写真だけを取得し、出典・作者・ライセンスを記録する。
 *
 * 使い方（リポジトリ直下で実行。Node 20 以上）:
 *   node scripts/seed/fetch-commons-photos.mjs
 *   node scripts/seed/fetch-commons-photos.mjs --spot kenrokuen --per-spot 6
 *   node scripts/seed/fetch-commons-photos.mjs --dry-run
 *   node scripts/seed/fetch-commons-photos.mjs --overwrite
 *
 * 入力:
 *   seed-data/kanazawa/spots.json
 *     [{ key, name, commons: { categories: string[], search: string[] } | null }, ...]
 *   環境変数 SEED_CONTACT（任意。User-Agent の連絡先。例: you@example.com）
 *
 * 出力:
 *   public/seed/photos/<key>/<n>.webp   長辺 1600px（品質 82）
 *   public/seed/photos/<key>/<n>_t.webp 長辺 400px（品質 80）
 *   seed-data/kanazawa/photos.json      取得した写真の一覧（既存があればマージ。同じ fullPath は上書き）
 *   docs/photo-credits.md               作者・ライセンス・出典の一覧（CC BY / BY-SA の表示義務）
 *
 * オプション:
 *   --spot <key>    1 スポットだけ処理する
 *   --per-spot N    1 スポットあたりの最大枚数（既定 4）
 *   --dry-run       ダウンロードせず候補とライセンスを表示する
 *   --overwrite     既存の写真・photos.json の同じスポットの行を捨てて取り直す
 *
 * 採用条件:
 *   ライセンスが CC0 / CC BY 2.0〜4.0 / CC BY-SA 2.0〜4.0 / Public domain のいずれか（NC・ND は不採用）
 *   MIME が image/jpeg か image/png、幅 800px 以上
 *   同じスポットでは季節（season）と時間帯（timeOfDay）ができるだけ異なる写真を優先する
 *
 * Commons API へのリクエストは 200ms 間隔。失敗したスポットは飛ばして最後に一覧表示する。
 * EXIF は sharp の再エンコードで除去される（withMetadata() は使わない）。
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const REQUEST_INTERVAL_MS = 200;
const MIN_WIDTH = 800;
const FULL_LONG_EDGE = 1600;
const THUMB_LONG_EDGE = 400;
const FULL_QUALITY = 82;
const THUMB_QUALITY = 80;
const THUMB_REQUEST_WIDTH = 2000;
const IMAGEINFO_BATCH = 20;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..", "..");
export const DEFAULT_PATHS = {
  spotsJson: path.join(REPO_ROOT, "seed-data", "kanazawa", "spots.json"),
  photosJson: path.join(REPO_ROOT, "seed-data", "kanazawa", "photos.json"),
  photosDir: path.join(REPO_ROOT, "public", "seed", "photos"),
  creditsMd: path.join(REPO_ROOT, "docs", "photo-credits.md"),
};

// ---------- 純粋関数（テスト対象） ----------

/** 採用できるライセンス（NC・ND は含まない） */
const LICENSE_RE = /^(?:CC0(?:\s+1\.0)?|CC\s+BY(?:-SA)?\s+[234]\.[0-9]|Public\s+domain)$/i;

/** extmetadata.LicenseShortName が採用条件を満たすか */
export function isAcceptableLicense(shortName) {
  if (typeof shortName !== "string") return false;
  const s = shortName.trim();
  if (/\b(NC|ND)\b/i.test(s)) return false;
  return LICENSE_RE.test(s);
}

export function isAcceptableMime(mime) {
  return mime === "image/jpeg" || mime === "image/png";
}

/** 題名・説明・カテゴリの語から季節を推定する。分からなければ null */
export function inferSeason(text) {
  const t = String(text ?? "");
  if (/雪|snow|winter|冬/i.test(t)) return "winter";
  if (/桜|cherry|sakura|spring|春/i.test(t)) return "spring";
  if (/紅葉|autumn|\bfall\b|maple|秋/i.test(t)) return "autumn";
  if (/summer|夏/i.test(t)) return "summer";
  return null;
}

/** 夜・ライトアップなら night、それ以外は day */
export function inferTimeOfDay(text) {
  const t = String(text ?? "");
  if (/夜|\bnight\b|ライトアップ|illuminat|夜景|\bevening\b|\bdusk\b/i.test(t)) return "night";
  return "day";
}

/** HTML（extmetadata.Artist など）をテキスト化する */
export function stripHtml(html) {
  if (typeof html !== "string") return "";
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "File:Foo bar.jpg" → 出典 URL */
export function sourceUrlOf(title) {
  const name = String(title)
    .replace(/^File:/, "")
    .replace(/ /g, "_");
  return `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(name).replace(/%2F/g, "/")}`;
}

/**
 * imageinfo の 1 ページ分（API の pages[*]）を候補に変換する。採用条件を満たさなければ null。
 */
export function toCandidate(page) {
  const info = page?.imageinfo?.[0];
  if (!info) return null;
  const meta = info.extmetadata ?? {};
  const license = meta.LicenseShortName?.value ?? "";
  if (!isAcceptableLicense(license)) return null;
  if (!isAcceptableMime(info.mime)) return null;
  const width = Number(info.width ?? 0);
  const height = Number(info.height ?? 0);
  if (!(width >= MIN_WIDTH)) return null;
  const description = stripHtml(meta.ImageDescription?.value ?? "");
  const categories = String(meta.Categories?.value ?? "");
  const hint = `${page.title} ${description} ${categories} ${meta.ObjectName?.value ?? ""}`;
  return {
    title: page.title,
    width,
    height,
    mime: info.mime,
    url: info.url,
    thumbUrl: info.thumburl ?? null,
    author: stripHtml(meta.Artist?.value ?? "") || "不明",
    license: license.trim(),
    licenseUrl: meta.LicenseUrl?.value ?? null,
    sourceUrl: sourceUrlOf(page.title),
    description,
    season: inferSeason(hint),
    timeOfDay: inferTimeOfDay(hint),
  };
}

/**
 * 季節・時間帯の組み合わせができるだけ異なるように最大 limit 件を選ぶ。
 * 同じ組み合わせしか残っていなければ幅の大きい順に埋める。
 */
export function selectDiverse(candidates, limit, exclude = new Set()) {
  const seen = new Set();
  const pool = candidates
    .filter((c) => !exclude.has(c.sourceUrl))
    .filter((c) => (seen.has(c.title) ? false : (seen.add(c.title), true)))
    .sort((a, b) => Number(Boolean(b.season)) - Number(Boolean(a.season)) || b.width - a.width);
  const picked = [];
  const used = new Set();
  while (picked.length < limit && pool.length > 0) {
    let idx = pool.findIndex((c) => !used.has(`${c.season ?? "unknown"}/${c.timeOfDay}`));
    if (idx < 0) idx = 0;
    const [c] = pool.splice(idx, 1);
    used.add(`${c.season ?? "unknown"}/${c.timeOfDay}`);
    picked.push(c);
  }
  return picked;
}

/** photos.json の 1 行を作る */
export function toPhotoEntry(spotKey, n, candidate, size) {
  return {
    spotKey,
    file: `${n}.webp`,
    fullPath: `seed/photos/${spotKey}/${n}.webp`,
    thumbPath: `seed/photos/${spotKey}/${n}_t.webp`,
    width: size.width,
    height: size.height,
    title: candidate.title,
    author: candidate.author,
    license: candidate.license,
    licenseUrl: candidate.licenseUrl,
    sourceUrl: candidate.sourceUrl,
    season: candidate.season,
    timeOfDay: candidate.timeOfDay,
  };
}

/** 既存の photos.json と新しい行をマージする（同じ fullPath は上書き） */
export function mergePhotos(existing, added) {
  const map = new Map();
  for (const p of existing ?? []) map.set(p.fullPath, p);
  for (const p of added ?? []) map.set(p.fullPath, p);
  return [...map.values()].sort((a, b) => a.fullPath.localeCompare(b.fullPath, "en", { numeric: true }));
}

/** photos.json の行から次の番号を決める */
export function nextIndex(photos, spotKey) {
  let max = 0;
  for (const p of photos ?? []) {
    if (p.spotKey !== spotKey) continue;
    const m = /^(\d+)\.webp$/.exec(p.file ?? "");
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/** docs/photo-credits.md の本文 */
export function renderCredits(photos, spots) {
  const nameOf = new Map((spots ?? []).map((s) => [s.key, s.name]));
  const byKey = new Map();
  for (const p of photos) {
    if (!byKey.has(p.spotKey)) byKey.set(p.spotKey, []);
    byKey.get(p.spotKey).push(p);
  }
  const lines = [
    "# 写真のクレジット（Wikimedia Commons）",
    "",
    "このリポジトリの `public/seed/photos/` にある初期データ用の写真は、Wikimedia Commons で公開されている",
    "自由ライセンス（CC0、CC BY、CC BY-SA、パブリックドメイン）の作品を、長辺 1600px / 400px の WebP に変換して収録したものです。",
    "変換（リサイズ・再エンコード・EXIF の除去）以外の改変は行っていません。",
    "",
    "CC BY および CC BY-SA の作品は、作者名・ライセンス名・出典へのリンクを表示する義務があります。",
    "アプリ内で表示する場合もこの一覧（または同等の表示）を参照できるようにしてください。",
    "CC BY-SA の作品を改変して再配布する場合は同じライセンスで公開する必要があります。",
    "この一覧は `scripts/seed/fetch-commons-photos.mjs` が生成します。手で編集しないでください。",
    "",
  ];
  const keys = [...byKey.keys()].sort();
  for (const key of keys) {
    const rows = byKey.get(key).sort((a, b) => a.file.localeCompare(b.file, "en", { numeric: true }));
    lines.push(`## ${nameOf.get(key) ?? key}（\`${key}\`）`, "");
    lines.push("| ファイル | 作者 | ライセンス | 出典 | 季節 / 時間帯 |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const p of rows) {
      const lic = p.licenseUrl ? `[${p.license}](${p.licenseUrl})` : p.license;
      const title = p.title.replace(/^File:/, "").replace(/\|/g, "\\|");
      const author = String(p.author).replace(/\|/g, "\\|");
      lines.push(
        `| ${p.file} | ${author} | ${lic} | [${title}](${p.sourceUrl}) | ${p.season ?? "不明"} / ${p.timeOfDay} |`,
      );
    }
    lines.push("");
  }
  if (keys.length === 0) lines.push("（まだ写真がありません）", "");
  return lines.join("\n");
}

export function parseArgs(argv) {
  const out = { spot: null, perSpot: 4, dryRun: false, overwrite: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--spot") out.spot = argv[++i] ?? null;
    else if (a.startsWith("--spot=")) out.spot = a.slice(7);
    else if (a === "--per-spot") out.perSpot = Number(argv[++i]);
    else if (a.startsWith("--per-spot=")) out.perSpot = Number(a.slice(11));
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--overwrite") out.overwrite = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else throw new Error(`不明なオプションです: ${a}`);
  }
  if (!Number.isInteger(out.perSpot) || out.perSpot < 1 || out.perSpot > 20) {
    throw new Error("--per-spot は 1〜20 の整数で指定してください");
  }
  return out;
}

// ---------- Commons API ----------

function userAgent() {
  const contact = process.env.SEED_CONTACT || "unknown";
  return `dokoiku-seed/1.0 (contact: ${contact})`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** API クライアント。fetch を差し替えられる（テスト用） */
export function createCommonsClient({ fetchImpl = globalThis.fetch, intervalMs = REQUEST_INTERVAL_MS } = {}) {
  let last = 0;
  async function api(params) {
    const wait = last + intervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const url = new URL(COMMONS_API);
    url.searchParams.set("format", "json");
    url.searchParams.set("formatversion", "2");
    url.searchParams.set("origin", "*");
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const res = await fetchImpl(url.toString(), {
      headers: { "User-Agent": userAgent(), Accept: "application/json" },
    });
    if (!res.ok)
      throw new Error(
        `Commons API ${res.status}: ${url.searchParams.get("list") ?? url.searchParams.get("prop")}`,
      );
    const json = await res.json();
    if (json.error) throw new Error(`Commons API error: ${json.error.info ?? json.error.code}`);
    return json;
  }

  return {
    async categoryFiles(category, limit = 50) {
      const title = category.startsWith("Category:") ? category : `Category:${category}`;
      const json = await api({
        action: "query",
        list: "categorymembers",
        cmtitle: title,
        cmtype: "file",
        cmlimit: limit,
      });
      return (json.query?.categorymembers ?? []).map((m) => m.title);
    },
    async searchFiles(query, limit = 30) {
      const json = await api({
        action: "query",
        list: "search",
        srsearch: query,
        srnamespace: 6,
        srlimit: limit,
      });
      return (json.query?.search ?? []).map((m) => m.title);
    },
    async imageInfo(titles) {
      const out = [];
      for (let i = 0; i < titles.length; i += IMAGEINFO_BATCH) {
        const batch = titles.slice(i, i + IMAGEINFO_BATCH);
        const json = await api({
          action: "query",
          prop: "imageinfo",
          titles: batch.join("|"),
          iiprop: "url|size|mime|extmetadata",
          iiurlwidth: THUMB_REQUEST_WIDTH,
          iiextmetadatafilter: "LicenseShortName|LicenseUrl|Artist|ImageDescription|Categories|ObjectName",
        });
        out.push(...(json.query?.pages ?? []));
      }
      return out;
    },
    async download(url) {
      const wait = last + intervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      const res = await fetchImpl(url, { headers: { "User-Agent": userAgent() } });
      if (!res.ok) throw new Error(`ダウンロード失敗 ${res.status}: ${url}`);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

/** 1 スポットの候補（採用条件を満たすもの）を集める */
export async function collectCandidates(client, spot) {
  const titles = [];
  const seen = new Set();
  const push = (t) => {
    if (!seen.has(t)) {
      seen.add(t);
      titles.push(t);
    }
  };
  for (const cat of spot.commons?.categories ?? []) {
    try {
      (await client.categoryFiles(cat)).forEach(push);
    } catch (e) {
      console.warn(`  カテゴリ ${cat} の取得に失敗: ${e.message}`);
    }
  }
  for (const q of spot.commons?.search ?? []) {
    try {
      (await client.searchFiles(q)).forEach(push);
    } catch (e) {
      console.warn(`  検索 "${q}" に失敗: ${e.message}`);
    }
  }
  if (titles.length === 0) return [];
  const pages = await client.imageInfo(titles);
  return pages.map(toCandidate).filter(Boolean);
}

// ---------- 画像変換 ----------

async function loadSharp() {
  const mod = await import("sharp");
  return mod.default ?? mod;
}

/** バイト列を 1600 / 400 の WebP にして保存し、本画像のサイズを返す */
export async function convertAndSave(buffer, fullFile, thumbFile) {
  const sharp = await loadSharp();
  await fsp.mkdir(path.dirname(fullFile), { recursive: true });
  const fullInfo = await sharp(buffer)
    .rotate()
    .resize({ width: FULL_LONG_EDGE, height: FULL_LONG_EDGE, fit: "inside", withoutEnlargement: true })
    .webp({ quality: FULL_QUALITY })
    .toFile(fullFile);
  await sharp(buffer)
    .rotate()
    .resize({ width: THUMB_LONG_EDGE, height: THUMB_LONG_EDGE, fit: "inside", withoutEnlargement: true })
    .webp({ quality: THUMB_QUALITY })
    .toFile(thumbFile);
  return { width: fullInfo.width, height: fullInfo.height };
}

/**
 * 1 スポットを処理して photos.json の行を返す。
 * deps: { client, photosDir, existing（photos.json の行）, perSpot, dryRun, overwrite }
 */
export async function processSpot(spot, deps) {
  const { client, photosDir, perSpot, dryRun, overwrite } = deps;
  const existing = overwrite
    ? (deps.existing ?? []).filter((p) => p.spotKey !== spot.key)
    : (deps.existing ?? []);
  const candidates = await collectCandidates(client, spot);
  const already = new Set(existing.filter((p) => p.spotKey === spot.key).map((p) => p.sourceUrl));
  const selected = selectDiverse(candidates, perSpot, already);
  console.log(`  候補 ${candidates.length} 件、採用 ${selected.length} 件`);
  for (const c of selected) {
    console.log(
      `    ${c.title} [${c.license}] ${c.width}x${c.height} ${c.season ?? "季節不明"}/${c.timeOfDay} by ${c.author}`,
    );
  }
  if (dryRun) return { entries: [], existing };

  const entries = [];
  let n = nextIndex(existing, spot.key);
  for (const c of selected) {
    const fullFile = path.join(photosDir, spot.key, `${n}.webp`);
    const thumbFile = path.join(photosDir, spot.key, `${n}_t.webp`);
    try {
      const buf = await client.download(c.thumbUrl ?? c.url);
      const size = await convertAndSave(buf, fullFile, thumbFile);
      entries.push(toPhotoEntry(spot.key, n, c, size));
      console.log(`    保存: ${path.relative(REPO_ROOT, fullFile)} (${size.width}x${size.height})`);
      n += 1;
    } catch (e) {
      console.warn(`    取得失敗（飛ばします）: ${c.title}: ${e.message}`);
    }
  }
  return { entries, existing };
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
}

async function removeSpotFiles(photosDir, key) {
  await fsp.rm(path.join(photosDir, key), { recursive: true, force: true });
}

// ---------- main ----------

export async function main(argv = process.argv.slice(2), paths = DEFAULT_PATHS) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(
      "使い方: node scripts/seed/fetch-commons-photos.mjs [--spot <key>] [--per-spot N] [--dry-run] [--overwrite]",
    );
    return 0;
  }
  if (!fs.existsSync(paths.spotsJson)) {
    console.error(
      [
        `入力ファイルが見つかりません: ${paths.spotsJson}`,
        "スポット一覧（配列。各要素に key, name, commons: { categories: string[], search: string[] } | null）を先に用意してください。",
        "例:",
        '  [{ "key": "kenrokuen", "name": "兼六園", "commons": { "categories": ["Kenroku-en"], "search": ["Kenrokuen"] } }]',
      ].join("\n"),
    );
    return 1;
  }
  const spots = await readJson(paths.spotsJson, []);
  if (!Array.isArray(spots)) {
    console.error("spots.json は配列である必要があります");
    return 1;
  }
  let targets = spots.filter((s) => s && typeof s.key === "string" && /^[a-z0-9-]+$/.test(s.key));
  if (args.spot) {
    targets = targets.filter((s) => s.key === args.spot);
    if (targets.length === 0) {
      console.error(`--spot ${args.spot} に一致するスポットがありません`);
      return 1;
    }
  }
  if (!process.env.SEED_CONTACT) {
    console.warn(
      "SEED_CONTACT が未設定です。User-Agent の連絡先として環境変数 SEED_CONTACT を設定することを推奨します。",
    );
  }

  let photos = await readJson(paths.photosJson, []);
  const client = createCommonsClient();
  const failed = [];
  let total = 0;

  for (const spot of targets) {
    console.log(`\n[${spot.key}] ${spot.name}`);
    if (
      !spot.commons ||
      ((spot.commons.categories ?? []).length === 0 && (spot.commons.search ?? []).length === 0)
    ) {
      console.log(
        "  commons の指定がないため飛ばします（自分たちで撮った写真を import-posts で入れてください）",
      );
      continue;
    }
    try {
      if (args.overwrite && !args.dryRun) await removeSpotFiles(paths.photosDir, spot.key);
      const { entries, existing } = await processSpot(spot, {
        client,
        photosDir: paths.photosDir,
        existing: photos,
        perSpot: args.perSpot,
        dryRun: args.dryRun,
        overwrite: args.overwrite,
      });
      if (!args.dryRun) {
        photos = mergePhotos(existing, entries);
        total += entries.length;
        // スポットごとに保存して途中で止まっても結果が残るようにする
        await fsp.mkdir(path.dirname(paths.photosJson), { recursive: true });
        await fsp.writeFile(paths.photosJson, JSON.stringify(photos, null, 2) + "\n", "utf8");
      }
    } catch (e) {
      failed.push({ key: spot.key, reason: e.message });
      console.warn(`  失敗（飛ばします）: ${e.message}`);
    }
  }

  if (!args.dryRun) {
    await fsp.mkdir(path.dirname(paths.creditsMd), { recursive: true });
    await fsp.writeFile(paths.creditsMd, renderCredits(photos, spots), "utf8");
    console.log(`\n保存した写真: ${total} 枚（合計 ${photos.length} 行）`);
    console.log(`photos.json: ${path.relative(REPO_ROOT, paths.photosJson)}`);
    console.log(`クレジット: ${path.relative(REPO_ROOT, paths.creditsMd)}`);
  }
  if (failed.length > 0) {
    console.log("\n失敗したスポット:");
    for (const f of failed) console.log(`  ${f.key}: ${f.reason}`);
  }
  return 0;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
