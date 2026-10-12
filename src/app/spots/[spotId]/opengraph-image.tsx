/**
 * S-02 スポット詳細の OGP 画像（1200x630）。LINE / X でリンクをカード表示するために使う。
 * 代表写真があれば背景に敷き、スポット名・投稿数・カテゴリ・サービス名を重ねる。
 * 写真が取れない／フォントが取れないときは写真なし／英数だけのレイアウトに落とす。
 */
import { ImageResponse } from "next/og";
import { CATEGORY_LABELS } from "@/lib/domain/constants";
import { OG_COLORS, OG_FONT_STACK, OG_SITE_NAME, OG_SITE_NAME_EN, OG_SIZE } from "@/lib/og/brand";
import { asciiOnly, loadJapaneseFonts } from "@/lib/og/fonts";
import { fetchImageDataUri } from "@/lib/og/images";
import { getRepo } from "@/lib/repo";

export const dynamic = "force-dynamic";
export const alt = "スポットの写真と名前";
export const size = OG_SIZE;
export const contentType = "image/png";

type Props = { params: Promise<{ spotId: string }> };

export default async function Image({ params }: Props) {
  const { spotId } = await params;
  const repo = await getRepo();
  const spot = await repo.spots.getById(spotId);

  const name = spot?.name ?? "スポットが見つかりません";
  const category = spot ? CATEGORY_LABELS[spot.category] : "";
  const posts = spot ? `投稿 ${spot.postCount} 件` : "";
  const [fonts, photo] = await Promise.all([
    loadJapaneseFonts([name, category, posts, OG_SITE_NAME], [700]),
    fetchImageDataUri(spot?.coverFullUrl ?? spot?.coverThumbUrl),
  ]);
  const ja = fonts.length > 0;
  const title = ja ? name : asciiOnly(name, spot ? "Spot" : "Not found");
  const siteName = ja ? OG_SITE_NAME : OG_SITE_NAME_EN;
  const badges = ja
    ? [category, posts].filter(Boolean)
    : [spot?.category ?? "", spot ? `${spot.postCount} posts` : ""].filter(Boolean);
  const fg = photo ? "#ffffff" : OG_COLORS.text;
  const muted = photo ? "rgba(255,255,255,0.92)" : OG_COLORS.textMuted;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          position: "relative",
          fontFamily: OG_FONT_STACK,
          background: photo
            ? OG_COLORS.text
            : `linear-gradient(135deg, ${OG_COLORS.primarySoft} 0%, ${OG_COLORS.surface} 60%, ${OG_COLORS.background} 100%)`,
        }}
      >
        {photo ? (
          <img
            src={photo}
            alt=""
            width={size.width}
            height={size.height}
            style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : null}
        {photo ? (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              background: "linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,0.72) 100%)",
            }}
          />
        ) : null}
        <div
          style={{
            position: "absolute",
            top: 40,
            left: 56,
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "12px 22px",
            borderRadius: 999,
            background: photo ? "rgba(255,255,255,0.92)" : OG_COLORS.primary,
            color: photo ? OG_COLORS.primary : "#ffffff",
            fontSize: 30,
            fontWeight: 700,
          }}
        >
          {siteName}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20, padding: "0 56px 52px" }}>
          <div
            style={{
              display: "flex",
              fontSize: 72,
              fontWeight: 700,
              lineHeight: 1.2,
              color: fg,
              lineClamp: 2,
              overflow: "hidden",
            }}
          >
            {title}
          </div>
          <div style={{ display: "flex", gap: 16, fontSize: 32, color: muted }}>
            {badges.map((b) => (
              <div
                key={b}
                style={{
                  display: "flex",
                  padding: "6px 18px",
                  borderRadius: 999,
                  border: `2px solid ${photo ? "rgba(255,255,255,0.6)" : OG_COLORS.border}`,
                  background: photo ? "rgba(0,0,0,0.25)" : OG_COLORS.surface,
                }}
              >
                {b}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: fonts.length > 0 ? fonts : undefined },
  );
}
