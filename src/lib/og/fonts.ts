import "server-only";

/**
 * OGP 画像・しおり画像（next/og の ImageResponse）用の日本語フォント。
 * Satori に同梱されるのは英数のみ（Geist）なので、日本語は実行時に Google Fonts から
 * 必要な文字だけのサブセット（TTF）を取得する。public/fonts/ にはフォントを置かない方針。
 * 取得に失敗したら null を返し、呼び出し側は英数だけの文言に切り替える（ADR-0020）。
 */

export const OG_FONT_FAMILY = "Noto Sans JP";
const CSS_ENDPOINT = "https://fonts.googleapis.com/css2";
/** 旧いブラウザ扱いにして TTF（Satori が読める形式）を返させる。woff2 は読めない */
const USER_AGENT = "Mozilla/5.0";
const TIMEOUT_MS = 5_000;
/** サブセットに含める文字数の上限（URL 長と取得時間の抑制） */
const MAX_CHARS = 400;
const CACHE_MAX = 64;

export type OgFontWeight = 400 | 700;

export interface OgFont {
  name: string;
  data: ArrayBuffer;
  weight: OgFontWeight;
  style: "normal";
}

const cache = new Map<string, Promise<ArrayBuffer | null>>();

/** 文字列群に含まれる文字を重複なく（英数も含めて）並べる */
export function uniqueChars(texts: string[]): string {
  const set = new Set<string>();
  for (const t of texts) for (const ch of t) if (!/\s/.test(ch)) set.add(ch);
  return [...set].slice(0, MAX_CHARS).join("");
}

/** 日本語フォントが使えないときの英数だけの文言。英数以外を落として空なら fallback */
export function asciiOnly(text: string, fallback: string): string {
  const ascii = text.replace(/[^\x20-\x7e]/g, "").replace(/\s+/g, " ").trim();
  return ascii || fallback;
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
}

async function fetchSubset(chars: string, weight: OgFontWeight): Promise<ArrayBuffer | null> {
  try {
    const params = new URLSearchParams({ family: `${OG_FONT_FAMILY}:wght@${weight}`, text: chars });
    const css = await fetchWithTimeout(`${CSS_ENDPOINT}?${params.toString()}`, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!css.ok) return null;
    const body = await css.text();
    // src: url(https://fonts.gstatic.com/...) format('truetype')
    const m = body.match(/src:\s*url\(([^)]+)\)\s*format\('(truetype|opentype)'\)/);
    if (!m) return null;
    const font = await fetchWithTimeout(m[1]);
    if (!font.ok) return null;
    return await font.arrayBuffer();
  } catch (err) {
    console.warn("[og] 日本語フォントの取得に失敗しました", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * 画像に出す文字列群から Noto Sans JP のサブセットを取得する。
 * 返り値が空（取得失敗）なら、呼び出し側は `asciiOnly` で英数の文言に切り替える。
 */
export async function loadJapaneseFonts(
  texts: string[],
  weights: OgFontWeight[] = [700],
): Promise<OgFont[]> {
  // 英数と記号は必ず含める（数字・時刻・記号の字形をそろえるため）
  const chars = uniqueChars([...texts, "0123456789:~-/()|"]);
  const fonts: OgFont[] = [];
  for (const weight of weights) {
    const key = `${weight}:${chars}`;
    let p = cache.get(key);
    if (!p) {
      if (cache.size >= CACHE_MAX) cache.clear();
      p = fetchSubset(chars, weight);
      cache.set(key, p);
    }
    const data = await p;
    if (!data) {
      cache.delete(key);
      return [];
    }
    fonts.push({ name: OG_FONT_FAMILY, data, weight, style: "normal" });
  }
  return fonts;
}
