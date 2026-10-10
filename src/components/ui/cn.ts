/** クラス名を空白区切りで連結する（falsy は無視） */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
