/**
 * SNS 共有（LINE / X など）のリンクと文言。外部 API は使わず、各サービスの公開 URL を開くだけ。
 * 純粋関数はテストしやすいように ShareButton から分けている。
 */

export const SITE_NAME = "旅行どこいこう";

/** パス（/spots/…）または絶対 URL を、ブラウザの origin を基準に絶対 URL へそろえる */
export function absoluteShareUrl(url: string, origin: string): string {
  return new URL(url, origin).toString();
}

/** X（旧 Twitter）の投稿画面。新しいタブで開く */
export function xShareUrl(text: string, url: string): string {
  const params = new URLSearchParams({ text, url });
  return `https://twitter.com/intent/tweet?${params.toString()}`;
}

/** LINE の「送る」画面。新しいタブで開く */
export function lineShareUrl(url: string): string {
  return `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}`;
}

/** スポット詳細の共有文言：「兼六園（投稿 12 件）| 旅行どこいこう」 */
export function spotShareText(name: string, postCount: number): string {
  return `${name}（投稿 ${postCount} 件）| ${SITE_NAME}`;
}

/** 保存済みプランの共有文言：「2026年10月12日のプラン（3か所）| 旅行どこいこう」 */
export function planShareText(dateLabel: string, spotCount: number): string {
  return `${dateLabel}のプラン（${spotCount}か所）| ${SITE_NAME}`;
}

/** 共有リストの共有文言：「金沢旅行（5件）| 旅行どこいこう」 */
export function listShareText(name: string, itemCount: number): string {
  return `${name}（${itemCount}件）| ${SITE_NAME}`;
}

/** Web Share API の判定結果。`navigator.share` が無い環境（主に PC）では false */
export function canNativeShare(nav: Pick<Navigator, "share"> | undefined): boolean {
  return typeof nav?.share === "function";
}
