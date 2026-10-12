#!/usr/bin/env node
/**
 * public/seed/photos 配下の WebP を、同じパス（seed/photos/<key>/<n>.webp）で
 * Supabase Storage のバケット post-images にアップロードする（service role）。
 * supabase/seed.sql の投稿（post_images.full_path / thumb_path）がこのパスを参照する前提。
 *
 * 使い方（リポジトリ直下で実行。Node 20 以上）:
 *   環境変数 NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定して
 *   node scripts/seed/upload-seed-photos.mjs
 *   node scripts/seed/upload-seed-photos.mjs --dry-run      送信せず対象ファイルを表示する
 *   node scripts/seed/upload-seed-photos.mjs --dir <別のフォルダ>
 *
 * 既に同じパスがある場合は上書き（upsert）する。
 */
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const BUCKET = "post-images";
const STORAGE_PREFIX = "seed/photos";

function parseArgs(argv) {
  const out = { dryRun: false, dir: path.join(REPO_ROOT, "public", "seed", "photos") };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--dir") out.dir = path.resolve(argv[++i] ?? "");
    else if (a.startsWith("--dir=")) out.dir = path.resolve(a.slice(6));
    else throw new Error(`不明なオプションです: ${a}`);
  }
  return out;
}

/** フォルダ配下の .webp を再帰的に集める（フォルダからの相対パス、区切りは "/"） */
export async function listWebpFiles(dir) {
  const out = [];
  async function walk(current, rel) {
    let entries;
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch (e) {
      if (e.code === "ENOENT") return;
      throw e;
    }
    for (const ent of entries) {
      const relPath = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) await walk(path.join(current, ent.name), relPath);
      else if (ent.isFile() && ent.name.toLowerCase().endsWith(".webp")) out.push(relPath);
    }
  }
  await walk(dir, "");
  return out.sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const files = await listWebpFiles(args.dir);
  if (files.length === 0) {
    console.log(`アップロードする WebP がありません: ${args.dir}`);
    return 0;
  }
  console.log(`対象: ${files.length} ファイル（${args.dir} → ${BUCKET}/${STORAGE_PREFIX}/...）`);
  if (args.dryRun) {
    for (const f of files) console.log(`  ${STORAGE_PREFIX}/${f}`);
    return 0;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定してください");
    return 1;
  }
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  let ok = 0;
  const failed = [];
  for (const [i, rel] of files.entries()) {
    const storagePath = `${STORAGE_PREFIX}/${rel}`;
    try {
      const data = await fsp.readFile(path.join(args.dir, rel));
      const res = await sb.storage
        .from(BUCKET)
        .upload(storagePath, data, { contentType: "image/webp", upsert: true });
      if (res.error) throw new Error(res.error.message);
      ok += 1;
      console.log(`  [${i + 1}/${files.length}] ${storagePath} (${(data.byteLength / 1024).toFixed(0)}KB)`);
    } catch (e) {
      failed.push({ path: storagePath, reason: e.message });
      console.log(`  [${i + 1}/${files.length}] 失敗 ${storagePath}: ${e.message}`);
    }
  }
  console.log(`\n成功 ${ok} 件、失敗 ${failed.length} 件`);
  for (const f of failed) console.log(`  ${f.path}: ${f.reason}`);
  return failed.length > 0 ? 1 : 0;
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
