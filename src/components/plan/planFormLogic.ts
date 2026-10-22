/**
 * S-09 経路作成（条件入力）の純粋なロジック。画面から切り離してテストする。
 * - 対象スポットの初期選択（F-5-1）
 * - 作り方ごとの preferences の組み立て（F-5-B）
 * - 停止中・未設定による移動手段・作り方の無効化（F-8、F-5 例外）
 */
import {
  FEATURE_LABELS,
  LIMITS,
  TRAVEL_MODES,
  type Feature,
  type Interest,
  type Pace,
  type PlanMethod,
  type Priority,
  type TravelMode,
} from "@/lib/domain/constants";
import type { PlanPreferences, SpotSummary, SystemStatus, WishlistItem } from "@/lib/domain/types";
import { DEFAULT_PREFERENCES } from "./planSession";

export type SelectableItem = WishlistItem & { spot: SpotSummary };

/** 削除済み（spot が null）を除き、追加順に並べる */
export function selectableItems(items: readonly WishlistItem[]): SelectableItem[] {
  return items
    .filter((i): i is SelectableItem => i.spot !== null)
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.createdAt.localeCompare(b.item.createdAt) || a.index - b.index)
    .map(({ item }) => item);
}

/**
 * F-5-1：初期選択。8 か所以下なら全選択、9 か所以上なら「必ず行きたい」を優先して 8 か所まで（残りは追加順）。
 * 戻り値は追加順。
 */
export function initialSpotSelection(
  items: readonly WishlistItem[],
  max: number = LIMITS.planSpotsMax,
): string[] {
  const all = selectableItems(items);
  if (all.length <= max) return all.map((i) => i.spotId);
  const picked = new Set<string>();
  for (const i of all) if (i.mustVisit && picked.size < max) picked.add(i.spotId);
  for (const i of all) if (picked.size < max) picked.add(i.spotId);
  return all.filter((i) => picked.has(i.spotId)).map((i) => i.spotId);
}

/** 下書きの選択をリストの現状に合わせる（無いもの・削除済みを除き、上限で切る）。空なら初期選択 */
export function restoreSpotSelection(
  items: readonly WishlistItem[],
  saved: readonly string[] | undefined,
  max: number = LIMITS.planSpotsMax,
): string[] {
  if (!saved || saved.length === 0) return initialSpotSelection(items, max);
  const wanted = new Set(saved);
  const restored = selectableItems(items)
    .filter((i) => wanted.has(i.spotId))
    .slice(0, max)
    .map((i) => i.spotId);
  return restored.length > 0 ? restored : initialSpotSelection(items, max);
}

export interface ChosenPreferences {
  pace: Pace;
  interests: Interest[];
  priority: Priority;
}

/**
 * F-5-3 / F-5-4 / F-5-5：作り方に合わせて POST /plans/compute の preferences を作る。
 * - おまかせ：既定値（移動を少なく・ふつう）
 * - 重視するものを選ぶ：選んだペース・重視するもの・優先すること（時刻・順番・除外は無し）
 * - AIと相談：読み取った条件（chat）をそのまま使う
 */
export function buildPreferences(
  method: PlanMethod,
  chosen: ChosenPreferences,
  chatConditions?: PlanPreferences | null,
): PlanPreferences {
  if (method === "preferences") {
    return {
      ...DEFAULT_PREFERENCES,
      pace: chosen.pace,
      interests: [...chosen.interests],
      priority: chosen.priority,
    };
  }
  if (method === "chat" && chatConditions) {
    return { ...DEFAULT_PREFERENCES, ...chatConditions };
  }
  return { ...DEFAULT_PREFERENCES };
}

export interface Availability {
  disabled: boolean;
  /** 無効の理由（circle-pause ＋ 文字で表示） */
  reason: string | null;
}

const ENABLED: Availability = { disabled: false, reason: null };

function suspendedReason(feature: Feature): string {
  return `現在、${FEATURE_LABELS[feature]}は利用できません`;
}

export interface StatusView {
  status: SystemStatus;
  loading: boolean;
  isSuspended: (feature: Feature) => boolean;
}

/**
 * 移動手段ごとの利用可否。
 * - 公共交通：route_planning_transit が停止中なら無効（キー未設定は無効にせず概算で計算する）
 * - 徒歩・車：route_planning が停止中なら無効
 */
export function modeAvailability({ isSuspended }: StatusView): Record<TravelMode, Availability> {
  const transit = isSuspended("route_planning_transit")
    ? { disabled: true, reason: suspendedReason("route_planning_transit") }
    : ENABLED;
  const road = isSuspended("route_planning")
    ? { disabled: true, reason: suspendedReason("route_planning") }
    : ENABLED;
  return { transit, walking: road, driving: road };
}

/** 作り方ごとの利用可否。AI が停止中・未設定なら「AIと相談」だけ無効 */
export function methodAvailability({
  status,
  loading,
  isSuspended,
}: StatusView): Record<PlanMethod, Availability> {
  let chat = ENABLED;
  if (isSuspended("ai_chat")) {
    chat = { disabled: true, reason: `${suspendedReason("ai_chat")}（利用の上限に近づいたため）` };
  } else if (!loading && status.capabilities.ai === false) {
    chat = { disabled: true, reason: suspendedReason("ai_chat") };
  }
  return { auto: ENABLED, preferences: ENABLED, chat };
}

/** 選んだ移動手段が使えなければ、使える最初の移動手段に切り替える（全部使えなければそのまま） */
export function effectiveMode(
  selected: TravelMode,
  availability: Record<TravelMode, Availability>,
): TravelMode {
  if (!availability[selected].disabled) return selected;
  return TRAVEL_MODES.find((m) => !availability[m].disabled) ?? selected;
}

/** 公共交通の移動時間が概算になるか（キー未設定。停止中は別に無効化する） */
export function isTransitEstimated({ status, loading }: StatusView): boolean {
  return !loading && status.capabilities.transit === false;
}
