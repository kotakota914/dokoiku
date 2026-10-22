/**
 * GET /api/v1/plans/{planId}/image：旅のしおり画像（1080x1920 の縦長 PNG。Instagram ストーリー向け）。
 * 本人のみ（他人のプランは 403、無ければ 404、ID が UUID でなければ 400）。
 * 上部にタイトル・日付、中央にタイムライン（番号・スポット名・到着〜出発・移動分）、下部にサービス名。
 * 日本語フォントは実行時に取得し、取れなければ英数だけの文言にする（src/lib/og/fonts.ts）。
 */
import { ImageResponse } from "next/og";
import { route } from "@/lib/api/handler";
import { requireProfile } from "@/lib/auth/server";
import { TRAVEL_MODE_LABELS } from "@/lib/domain/constants";
import type { PlanItem } from "@/lib/domain/types";
import { OG_COLORS, OG_FONT_STACK, OG_SITE_NAME, OG_SITE_NAME_EN, STORY_SIZE } from "@/lib/og/brand";
import { asciiOnly, loadJapaneseFonts } from "@/lib/og/fonts";
import { getRepo } from "@/lib/repo";
import { getOwnedPlan } from "@/lib/services/plans";
import { formatDateJa } from "@/lib/utils/time";
import { uuidSchema } from "@/lib/validation/schemas";

type Params = { planId: string };

/** 画像に収まる行数（スポットと昼食休憩の合計） */
const MAX_ROWS = 9;
const DELETED_SPOT_NAME = "削除されたスポット";
const LUNCH_NAME = "昼食休憩";

interface Row {
  number: number | null;
  name: string;
  time: string;
  travel: string | null;
}

function buildRows(items: PlanItem[], nameOf: (spotId: string) => string, ja: boolean): Row[] {
  let n = 0;
  return items.map((item) => {
    const number = item.type === "spot" ? ++n : null;
    const rawName = item.type === "spot" ? nameOf(item.spotId) : LUNCH_NAME;
    const name = ja ? rawName : asciiOnly(rawName, item.type === "spot" ? `Spot ${number}` : "Lunch");
    const travel =
      item.travelMinToNext === null
        ? null
        : ja
          ? `移動 ${item.travelMinToNext}分`
          : `${item.travelMinToNext} min`;
    return { number, name, time: `${item.arrive}~${item.depart}`, travel };
  });
}

export const GET = route<Params>(async (_req, { params }) => {
  const user = await requireProfile();
  const planId = uuidSchema.parse((await params).planId);
  const repo = await getRepo();
  const plan = await getOwnedPlan(repo, user.id, planId);
  const spots = await repo.spots.getManyByIds(plan.params.spotIds);
  const names = new Map(spots.map((s) => [s.id, s.name] as const));
  const nameOf = (id: string) => names.get(id) ?? DELETED_SPOT_NAME;

  const dateJa = formatDateJa(plan.date);
  const originLabel = plan.params.origin.label || "出発地";
  const destinationLabel = plan.params.destination
    ? plan.params.destination.label || "到着地"
    : "出発地に戻らない";
  const modeLabel = TRAVEL_MODE_LABELS[plan.params.mode];
  const jaRows = buildRows(plan.result.items, nameOf, true);
  const hiddenCount = Math.max(0, jaRows.length - MAX_ROWS);
  const moreJa = hiddenCount > 0 ? `ほか ${hiddenCount} 件` : "";

  const fonts = await loadJapaneseFonts(
    [
      "旅のしおり",
      dateJa,
      originLabel,
      destinationLabel,
      modeLabel,
      LUNCH_NAME,
      DELETED_SPOT_NAME,
      "移動 分",
      moreJa,
      OG_SITE_NAME,
      ...jaRows.map((r) => r.name),
    ],
    [400, 700],
  );
  const ja = fonts.length > 0;
  const rows = (ja ? jaRows : buildRows(plan.result.items, nameOf, false)).slice(0, MAX_ROWS);
  const heading = ja ? "旅のしおり" : "Travel itinerary";
  const date = ja ? dateJa : plan.date;
  const routeLabel = ja
    ? `${originLabel} → ${destinationLabel}`
    : `${asciiOnly(originLabel, "Start")} -> ${asciiOnly(destinationLabel, "End")}`;
  const mode = ja ? modeLabel : plan.params.mode;
  const more = ja ? moreJa : hiddenCount > 0 ? `+${hiddenCount} more` : "";
  const siteName = ja ? OG_SITE_NAME : OG_SITE_NAME_EN;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        padding: "96px 72px 80px",
        fontFamily: OG_FONT_STACK,
        color: OG_COLORS.text,
        background: `linear-gradient(170deg, ${OG_COLORS.primarySoft} 0%, ${OG_COLORS.surface} 45%, ${OG_COLORS.background} 100%)`,
      }}
    >
      {/* 上部：タイトル・日付・出発→到着 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div
          style={{
            display: "flex",
            alignSelf: "flex-start",
            padding: "10px 24px",
            borderRadius: 999,
            background: OG_COLORS.primary,
            color: "#ffffff",
            fontSize: 34,
            fontWeight: 700,
          }}
        >
          {heading}
        </div>
        <div style={{ display: "flex", fontSize: 72, fontWeight: 700, lineHeight: 1.2 }}>{date}</div>
        <div
          style={{
            display: "flex",
            fontSize: 36,
            color: OG_COLORS.textMuted,
            lineClamp: 2,
            overflow: "hidden",
            lineHeight: 1.4,
          }}
        >
          {routeLabel}
        </div>
        <div style={{ display: "flex", gap: 16, fontSize: 32 }}>
          <div
            style={{
              display: "flex",
              padding: "6px 20px",
              borderRadius: 999,
              border: `2px solid ${OG_COLORS.border}`,
              background: OG_COLORS.surface,
            }}
          >
            {mode}
          </div>
          <div
            style={{
              display: "flex",
              padding: "6px 20px",
              borderRadius: 999,
              border: `2px solid ${OG_COLORS.border}`,
              background: OG_COLORS.surface,
            }}
          >
            {`${plan.params.startTime} - ${plan.result.endAt}`}
          </div>
        </div>
      </div>

      {/* タイムライン */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          marginTop: 56,
          padding: "40px 44px",
          borderRadius: 32,
          border: `2px solid ${OG_COLORS.border}`,
          background: OG_COLORS.surface,
        }}
      >
        {rows.map((r, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 72,
                  height: 72,
                  borderRadius: 999,
                  background: r.number === null ? OG_COLORS.primarySoft : OG_COLORS.primary,
                  color: r.number === null ? OG_COLORS.primaryStrong : "#ffffff",
                  fontSize: 36,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {r.number === null ? "-" : String(r.number)}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flexGrow: 1 }}>
                <div
                  style={{
                    display: "flex",
                    fontSize: 40,
                    fontWeight: 700,
                    lineHeight: 1.25,
                    lineClamp: 1,
                    overflow: "hidden",
                  }}
                >
                  {r.name}
                </div>
                <div style={{ display: "flex", fontSize: 32, color: OG_COLORS.textMuted }}>{r.time}</div>
              </div>
            </div>
            {r.travel !== null && i < rows.length - 1 ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 24,
                  height: 56,
                  marginLeft: 34,
                  borderLeft: `4px solid ${OG_COLORS.border}`,
                  paddingLeft: 58,
                  fontSize: 28,
                  color: OG_COLORS.textMuted,
                }}
              >
                {r.travel}
              </div>
            ) : i < rows.length - 1 ? (
              <div style={{ display: "flex", height: 24 }} />
            ) : null}
          </div>
        ))}
        {more ? (
          <div style={{ display: "flex", marginTop: 24, fontSize: 32, color: OG_COLORS.textMuted }}>
            {more}
          </div>
        ) : null}
      </div>

      {/* 下部：サービス名 */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          marginTop: 48,
          fontSize: 40,
          fontWeight: 700,
          color: OG_COLORS.primary,
        }}
      >
        {siteName}
      </div>
    </div>,
    {
      ...STORY_SIZE,
      fonts: fonts.length > 0 ? fonts : undefined,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
});
