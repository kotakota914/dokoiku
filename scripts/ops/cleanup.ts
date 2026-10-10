/**
 * 定期処理（要件定義書 12章）：一時ファイルと移動時間キャッシュの削除。
 * GitHub Actions（.github/workflows/cleanup.yml）から毎日 4:30 JST に実行する。
 *
 *   node --experimental-strip-types scripts/ops/cleanup.ts
 *
 * - Storage バケット post-images の posts/tmp/{userId}/ にある 24 時間以上前のオブジェクトを削除する
 *   （POST /uploads で発行したが投稿されなかった写真）。
 * - travel_time_cache の fetched_at が 30 日より古い行を削除する。
 *
 * 環境変数（GitHub Actions の secrets）
 *   SUPABASE_URL               Project URL（NEXT_PUBLIC_SUPABASE_URL でも可）
 *   SUPABASE_SERVICE_ROLE_KEY  service_role キー（RLS を通らない）
 *   NOTIFY_WEBHOOK_URL         任意。失敗時に Discord へ通知する
 *   CLEANUP_TMP_HOURS          任意。既定 24
 *   CLEANUP_CACHE_DAYS         任意。既定 30
 *   DRY_RUN=1                  任意。削除せずに件数だけ出す
 *
 * アプリのコード（src/）は path alias（@/）を使うため node から直接 import できない。
 * このスクリプトは supabase-js だけに依存する独立した実装にしている。
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "post-images";
const TMP_PREFIX = "posts/tmp";
const LIST_PAGE = 1000;
const REMOVE_BATCH = 100;

interface StorageObject {
  name: string;
  id: string | null;
  created_at: string | null;
  updated_at: string | null;
  metadata: Record<string, unknown> | null;
}

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

function requireEnv(name: string, fallback?: string): string {
  const v = env(name) ?? (fallback ? env(fallback) : undefined);
  if (!v) throw new Error(`${name} が設定されていません`);
  return v;
}

async function notify(message: string): Promise<void> {
  const url = env("NOTIFY_WEBHOOK_URL");
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message.slice(0, 2000) }),
    });
    if (!res.ok) console.error(`[notify] webhook responded ${res.status}`);
  } catch (err) {
    console.error("[notify] webhook failed", err instanceof Error ? err.message : err);
  }
}

/** フォルダ直下を全件列挙する（supabase-js の list はページングが必要） */
async function listAll(supabase: SupabaseClient, prefix: string): Promise<StorageObject[]> {
  const out: StorageObject[] = [];
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(prefix, { limit: LIST_PAGE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`storage.list(${prefix}): ${error.message}`);
    const rows = (data ?? []) as StorageObject[];
    out.push(...rows);
    if (rows.length < LIST_PAGE) break;
  }
  return out;
}

/** posts/tmp/{userId}/... の古いオブジェクトを削除し、削除件数を返す */
async function deleteStaleTmp(
  supabase: SupabaseClient,
  olderThanHours: number,
  dryRun: boolean,
): Promise<number> {
  const cutoff = Date.now() - olderThanHours * 60 * 60 * 1000;
  // list は 1 階層ずつしか返さない。posts/tmp 直下はユーザー ID のフォルダ（id が null）
  const folders = (await listAll(supabase, TMP_PREFIX)).filter((o) => o.id === null);
  const targets: string[] = [];
  for (const folder of folders) {
    const dir = `${TMP_PREFIX}/${folder.name}`;
    const files = (await listAll(supabase, dir)).filter((o) => o.id !== null);
    for (const f of files) {
      const stamp = f.created_at ?? f.updated_at;
      if (!stamp) continue;
      if (new Date(stamp).getTime() < cutoff) targets.push(`${dir}/${f.name}`);
    }
  }
  console.log(
    `[cleanup] 一時ファイル: ${folders.length} フォルダを確認、${targets.length} 件が ${olderThanHours} 時間以上前`,
  );
  if (dryRun || targets.length === 0) return targets.length;
  let removed = 0;
  for (let i = 0; i < targets.length; i += REMOVE_BATCH) {
    const batch = targets.slice(i, i + REMOVE_BATCH);
    const { error } = await supabase.storage.from(BUCKET).remove(batch);
    if (error) throw new Error(`storage.remove: ${error.message}`);
    removed += batch.length;
  }
  return removed;
}

/** travel_time_cache の古い行を削除し、削除件数を返す */
async function purgeTravelCache(
  supabase: SupabaseClient,
  olderThanDays: number,
  dryRun: boolean,
): Promise<number> {
  const cutoffIso = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
  if (dryRun) {
    const { count, error } = await supabase
      .from("travel_time_cache")
      .select("from_key", { count: "exact", head: true })
      .lt("fetched_at", cutoffIso);
    if (error) throw new Error(`travel_time_cache.count: ${error.message}`);
    return count ?? 0;
  }
  const { count, error } = await supabase
    .from("travel_time_cache")
    .delete({ count: "exact" })
    .lt("fetched_at", cutoffIso);
  if (error) throw new Error(`travel_time_cache.delete: ${error.message}`);
  return count ?? 0;
}

async function main(): Promise<void> {
  const url = requireEnv("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const tmpHours = Number(env("CLEANUP_TMP_HOURS") ?? 24);
  const cacheDays = Number(env("CLEANUP_CACHE_DAYS") ?? 30);
  const dryRun = env("DRY_RUN") === "1";
  if (!Number.isFinite(tmpHours) || tmpHours <= 0) throw new Error("CLEANUP_TMP_HOURS が不正です");
  if (!Number.isFinite(cacheDays) || cacheDays <= 0) throw new Error("CLEANUP_CACHE_DAYS が不正です");

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const started = Date.now();
  const tmpRemoved = await deleteStaleTmp(supabase, tmpHours, dryRun);
  const cacheRemoved = await purgeTravelCache(supabase, cacheDays, dryRun);
  const sec = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `[cleanup]${dryRun ? " (dry-run)" : ""} 一時ファイル ${tmpRemoved} 件、移動時間キャッシュ ${cacheRemoved} 行を削除しました（${sec} 秒）`,
  );
}

main().catch(async (err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[cleanup] 失敗しました: ${message}`);
  await notify(`[dokoiko][error] 一時ファイル削除に失敗しました: ${message}`);
  process.exit(1);
});
