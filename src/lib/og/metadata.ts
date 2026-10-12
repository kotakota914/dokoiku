import "server-only";
import type { Metadata } from "next";

const SITE_NAME = "旅行どこいこう";

/**
 * 各ページの generateMetadata で使う OGP の組み立て。
 * Next.js は `openGraph` をページ側で定義すると layout の値と深い併合をせず置き換えるため、
 * siteName / locale をここでそろえる。url は metadataBase（serverConfig.siteUrl）を基準にした相対パス。
 */
export function pageOpenGraph(input: {
  title: string;
  description: string;
  url: string;
}): NonNullable<Metadata["openGraph"]> {
  return {
    siteName: SITE_NAME,
    locale: "ja_JP",
    type: "article",
    title: input.title,
    description: input.description,
    url: input.url,
  };
}
