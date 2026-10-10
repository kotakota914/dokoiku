/**
 * ログイン後の戻り先（?next=）の安全判定。ブラウザ・サーバー共用（純粋関数）。
 * 同一オリジンのパスだけを許可し、オープンリダイレクトを防ぐ。
 */

/** ログイン・コールバック自身へ戻すとループするため既定値に落とす（パス境界で判定） */
const DISALLOWED_PATHS = ["/login", "/auth"];

function startsWithPath(next: string, base: string): boolean {
  if (!next.startsWith(base)) return false;
  const rest = next.charAt(base.length);
  return rest === "" || rest === "/" || rest === "?" || rest === "#";
}

export function isSafeNext(next: unknown): next is string {
  if (typeof next !== "string" || next.length === 0 || next.length > 2000) return false;
  // "/" で始まり、"//"（スキーム相対 URL）や "/\" で始まらないこと
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return false;
  // 改行や制御文字（ヘッダーインジェクション対策）
  if (/[\u0000-\u001f\u007f]/.test(next)) return false;
  // 絶対 URL（"/" で始まらないもの）は上で除外済み。念のため ":" を含むスキーム表記を弾く
  if (/^\/[^/?#]*:/.test(next)) return false;
  if (DISALLOWED_PATHS.some((p) => startsWithPath(next, p))) return false;
  return true;
}

/** 安全なら next、そうでなければ fallback（既定 "/"） */
export function safeNext(next: unknown, fallback = "/"): string {
  return isSafeNext(next) ? next : fallback;
}

/** ログイン画面の URL（戻り先付き） */
export function loginUrl(next: string): string {
  return next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`;
}

/** 初回プロフィール設定画面の URL（戻り先付き） */
export function welcomeUrl(next: string): string {
  return next === "/" ? "/welcome" : `/welcome?next=${encodeURIComponent(next)}`;
}
