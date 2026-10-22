/**
 * 経路作成・経路プラン画面（S-09〜S-12）の部品が共有する型と文言。
 */
import type { TravelMode } from "@/lib/domain/constants";
import type { PlanCandidate, PlanResult, SkipReason } from "@/lib/domain/types";

/** F-5-9：入らなかった理由の文言 */
export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  time_limit: "時間が足りません",
  no_route: "この区間の移動時間を取得できませんでした",
  opening_hours: "営業時間外",
  deleted: "削除されました",
  excluded: "除外した場所",
};

/** 「必ず行きたい」だけでも入らなかったとき・案が 1 つも無いときの案内（F-5 例外） */
export const PLAN_EMPTY_MESSAGE = "終了時刻を延ばすか、スポットを減らしてください";

/** 滞在時間の変更（F-5-10）：5 分刻み、15〜240 分 */
export const STAY_OPTIONS = Array.from({ length: (240 - 15) / 5 + 1 }, (_, i) => 15 + i * 5);

/** 8.1：移動手段のアイコン */
export const TRAVEL_MODE_ICONS: Record<TravelMode, "train-front" | "footprints" | "car"> = {
  transit: "train-front",
  walking: "footprints",
  driving: "car",
};

/** 画面で扱う 1 案。再計算の応答（PlanResult）を受け取ったあとは estimated などを持つことがある */
export type PlanCandidateView = PlanCandidate & Partial<Pick<PlanResult, "estimated">>;

/** 一部でも概算（目安）の区間がある案か */
export function isCandidateEstimated(c: PlanCandidateView, mode: TravelMode): boolean {
  if (typeof c.estimated === "boolean") return c.estimated;
  if (mode === "transit") return true;
  return c.items.some((i) => i.next?.estimated === true);
}

/** 保存（POST /plans）用の 1 案に変換する */
export function toPlanResult(c: PlanCandidateView, travelMatrixId: string, mode: TravelMode): PlanResult {
  return {
    ...c,
    totalTravelMin: c.stats.totalTravelMin,
    endAt: c.stats.endAt,
    travelMatrixId,
    estimated: isCandidateEstimated(c, mode),
  };
}

/** 歩く距離（m）を「約800m」「約2.8km」にする */
export function formatWalk(meters: number): string {
  const m = Math.max(0, Math.round(meters));
  if (m < 1000) return `約${m}m`;
  return `約${(Math.round(m / 100) / 10).toFixed(1)}km`;
}

/**
 * 保存済みプラン（v0.1 で保存したものを含む）や再計算の応答を、画面で扱う 1 案の形にそろえる。
 * stats・notes などが欠けていても表示できるように既存の値から補う。
 */
export function normalizeCandidate(
  input: Partial<PlanResult> & Pick<PlanCandidate, "items" | "skipped">,
  fallback?: PlanCandidateView,
): PlanCandidateView {
  const items = input.items;
  const spotCount = items.filter((i) => i.type === "spot").length;
  const lastDepart = items.length > 0 ? items[items.length - 1].depart : "";
  const stats = input.stats ?? {
    spotCount,
    totalTravelMin: input.totalTravelMin ?? fallback?.stats.totalTravelMin ?? 0,
    walkM: fallback?.stats.walkM ?? 0,
    endAt: input.endAt ?? lastDepart,
    bestTimeHits: items.filter((i) => i.type === "spot" && i.inBestTime).length,
  };
  return {
    ...fallback,
    ...input,
    id: fallback?.id ?? input.id ?? "saved",
    kind: fallback?.kind ?? input.kind ?? "fewest_moves",
    label: fallback?.label ?? input.label ?? "",
    reason: input.reason || fallback?.reason || "",
    items,
    skipped: input.skipped,
    notes: input.notes ?? fallback?.notes ?? [],
    stats,
    geometry: input.geometry ?? null,
  };
}
