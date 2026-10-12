/**
 * S-10 共有リストの OGP 画像（1200x630）：リスト名・件数・所有者。
 */
import { ImageResponse } from "next/og";
import { OG_COLORS, OG_FONT_STACK, OG_SITE_NAME, OG_SITE_NAME_EN, OG_SIZE } from "@/lib/og/brand";
import { asciiOnly, loadJapaneseFonts } from "@/lib/og/fonts";
import { getRepo } from "@/lib/repo";

export const dynamic = "force-dynamic";
export const alt = "共有リストの名前と件数";
export const size = OG_SIZE;
export const contentType = "image/png";

type Props = { params: Promise<{ token: string }> };

export default async function Image({ params }: Props) {
  const { token } = await params;
  const repo = await getRepo();
  const list = await repo.wishlists.getByShareToken(token);

  const name = list?.name ?? "このリストは共有されていません";
  const count = list ? `${list.items.length}件` : "";
  const owner = list ? `${list.ownerDisplayName}さんの行きたい場所リスト` : "";
  const fonts = await loadJapaneseFonts([name, count, owner, OG_SITE_NAME], [700]);
  const ja = fonts.length > 0;
  const title = ja ? name : asciiOnly(name, list ? "Wishlist" : "Not found");
  const sub = ja ? [count, owner].filter(Boolean) : list ? [`${list.items.length} spots`, "Shared wishlist"] : [];
  const siteName = ja ? OG_SITE_NAME : OG_SITE_NAME_EN;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "48px 56px",
          fontFamily: OG_FONT_STACK,
          color: OG_COLORS.text,
          background: `linear-gradient(135deg, ${OG_COLORS.primarySoft} 0%, ${OG_COLORS.surface} 60%, ${OG_COLORS.background} 100%)`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignSelf: "flex-start",
            padding: "12px 22px",
            borderRadius: 999,
            background: OG_COLORS.primary,
            color: "#ffffff",
            fontSize: 30,
            fontWeight: 700,
          }}
        >
          {siteName}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{ display: "flex", fontSize: 72, fontWeight: 700, lineHeight: 1.2, lineClamp: 2, overflow: "hidden" }}
          >
            {title}
          </div>
          <div style={{ display: "flex", gap: 16, fontSize: 32, color: OG_COLORS.textMuted }}>
            {sub.map((s) => (
              <div
                key={s}
                style={{
                  display: "flex",
                  padding: "6px 18px",
                  borderRadius: 999,
                  border: `2px solid ${OG_COLORS.border}`,
                  background: OG_COLORS.surface,
                }}
              >
                {s}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: fonts.length > 0 ? fonts : undefined },
  );
}
