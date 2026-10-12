/**
 * S-09 保存済みプランの OGP 画像（1200x630）：日付・スポット数・合計移動時間。
 * スポット名や座標は出さない（プランは本人のみ閲覧できるため、カードには集計値だけを載せる）。
 */
import { ImageResponse } from "next/og";
import { TRAVEL_MODE_LABELS } from "@/lib/domain/constants";
import { OG_COLORS, OG_FONT_STACK, OG_SITE_NAME, OG_SITE_NAME_EN, OG_SIZE } from "@/lib/og/brand";
import { asciiOnly, loadJapaneseFonts } from "@/lib/og/fonts";
import { getRepo } from "@/lib/repo";
import { formatDateJa } from "@/lib/utils/time";
import { formatMinutes } from "@/components/ui/icons";

export const dynamic = "force-dynamic";
export const alt = "経路プランの概要";
export const size = OG_SIZE;
export const contentType = "image/png";

type Props = { params: Promise<{ planId: string }> };

export default async function Image({ params }: Props) {
  const { planId } = await params;
  const repo = await getRepo();
  const plan = /^[0-9a-f-]{36}$/i.test(planId) ? await repo.plans.getById(planId) : null;

  const dateJa = plan ? formatDateJa(plan.date) : "プランが見つかりません";
  const stats = plan
    ? [
        { label: "訪問", value: `${plan.spotCount}か所`, en: `${plan.spotCount} spots` },
        { label: "合計移動時間", value: formatMinutes(plan.totalTravelMin), en: `${plan.totalTravelMin} min travel` },
        { label: "移動手段", value: TRAVEL_MODE_LABELS[plan.params.mode], en: plan.params.mode },
      ]
    : [];
  const fonts = await loadJapaneseFonts(
    [dateJa, "のプラン", OG_SITE_NAME, ...stats.flatMap((s) => [s.label, s.value])],
    [700],
  );
  const ja = fonts.length > 0;
  const title = ja ? `${dateJa}のプラン` : plan ? `Plan for ${plan.date}` : "Plan not found";
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
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={{ display: "flex", fontSize: 68, fontWeight: 700, lineHeight: 1.2 }}>{title}</div>
          <div style={{ display: "flex", gap: 20 }}>
            {stats.map((s) => (
              <div
                key={s.label}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  padding: "18px 28px",
                  borderRadius: 16,
                  border: `2px solid ${OG_COLORS.border}`,
                  background: OG_COLORS.surface,
                }}
              >
                <div style={{ display: "flex", fontSize: 26, color: OG_COLORS.textMuted }}>
                  {ja ? s.label : asciiOnly(s.label, "")}
                </div>
                <div style={{ display: "flex", fontSize: 40, fontWeight: 700 }}>{ja ? s.value : s.en}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: fonts.length > 0 ? fonts : undefined },
  );
}
