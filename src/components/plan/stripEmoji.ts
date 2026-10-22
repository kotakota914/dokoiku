/**
 * 8.1：AI の返答に絵文字が含まれていた場合は表示前に取り除く（サーバーでも除去するが念のため）。
 * 絵文字本体（Extended_Pictographic）、国旗の地域指示記号、異体字セレクタ、ZWJ、キーキャップ、肌の色を消す。
 */
const EMOJI_PATTERN =
  /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{FE0E}\u{FE0F}\u{200D}\u{20E3}]/gu;

export function stripEmoji(text: string): string {
  return text
    .replace(EMOJI_PATTERN, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
