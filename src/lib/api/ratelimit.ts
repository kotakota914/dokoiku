import "server-only";

/**
 * プロセス内の簡易レート制限（固定ウィンドウ）。
 * Vercel の複数インスタンスにまたがる厳密な制限ではないが、9.1 の要件（投稿 5件/分、外部検索 1回/秒）を
 * 1インスタンス内で守る。投稿はさらに DB の countRecentByUser でも確認する。
 */
const buckets = new Map<string, { windowStart: number; count: number }>();

export function checkRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const b = buckets.get(key);
  if (!b || now - b.windowStart >= windowMs) {
    buckets.set(key, { windowStart: now, count: 1 });
    return true;
  }
  if (b.count >= limit) return false;
  b.count += 1;
  return true;
}

/**
 * 枠を消費せずに「今 1 件通せるか」だけを返す。
 * 投稿のように「成功した操作だけを数える」場合は、入口で peek し、成功後に checkRateLimit で加算する。
 */
export function peekRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const b = buckets.get(key);
  if (!b || now - b.windowStart >= windowMs) return true;
  return b.count < limit;
}

/** テスト用 */
export function resetRateLimits() {
  buckets.clear();
}
