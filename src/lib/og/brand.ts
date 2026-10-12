import "server-only";

/** OGP 画像・しおり画像の共通の見た目（globals.css のトークンと同じ色） */
export const OG_COLORS = {
  primary: "#1769b8",
  primaryStrong: "#145a99",
  primarySoft: "#e7f1fb",
  background: "#f7f8fa",
  surface: "#ffffff",
  text: "#212529",
  textMuted: "#5f6670",
  border: "#dee2e6",
} as const;

export const OG_SITE_NAME = "旅行どこいこう";
export const OG_SITE_NAME_EN = "Dokoiku";

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const STORY_SIZE = { width: 1080, height: 1920 } as const;

/** 1 段落分の共通の見出し帯（サービス名） */
export const OG_FONT_STACK = `"Noto Sans JP", "Geist", sans-serif`;
