/**
 * 経路プラン画面（S-08 / S-09）の部品が共有する型。
 */
import type { PlanParams, PlanResult, SkipReason, SpotSummary } from "@/lib/domain/types";

export interface PlanResultViewProps {
  params: PlanParams;
  result: PlanResult;
  /** params.spotIds に対応するスポット（削除済みは含まれないことがある） */
  spots: SpotSummary[];
  listId: string;
  /** 保存済みプラン（/plans/[planId]）として表示するとき */
  saved?: { planId: string };
  /** 再計算で result が差し替わったときに呼ぶ（未保存プランの sessionStorage 更新用） */
  onResultChange?: (result: PlanResult) => void;
}

/** F-5-5：入らなかった理由の文言 */
export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  time_limit: "時間が足りません",
  no_route: "経路が見つかりませんでした",
  opening_hours: "営業時間外",
  deleted: "削除されました",
};

/** 「必ず行きたい」だけでも入らなかったときの案内（F-5 例外） */
export const PLAN_EMPTY_MESSAGE = "終了時刻を延ばすか、スポットを減らしてください";

/** 滞在時間の変更（F-5-6）：5 分刻み、15〜240 分 */
export const STAY_OPTIONS = Array.from({ length: (240 - 15) / 5 + 1 }, (_, i) => 15 + i * 5);
