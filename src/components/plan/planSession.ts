/**
 * 未保存の経路プラン（S-08 → S-09）をブラウザの sessionStorage で受け渡す。
 * キーと形は PlanForm と PlanResultPage で共有する。
 */
import type { PlanParams, PlanResult, SpotSummary } from "@/lib/domain/types";

export interface PlanSession {
  params: PlanParams;
  result: PlanResult;
  /** params.spotIds に対応するスポットの要約（結果画面で名前・座標を引くため） */
  spots: SpotSummary[];
}

export const PLAN_SESSION_KEY_PREFIX = "dokoiko.plan.";

export function planSessionKey(listId: string): string {
  return `${PLAN_SESSION_KEY_PREFIX}${listId}`;
}

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function savePlanSession(listId: string, session: PlanSession): boolean {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(planSessionKey(listId), JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
}

function isPlanSession(v: unknown): v is PlanSession {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  const params = o.params as Record<string, unknown> | undefined;
  const result = o.result as Record<string, unknown> | undefined;
  return (
    !!params &&
    typeof params === "object" &&
    Array.isArray(params.spotIds) &&
    !!result &&
    typeof result === "object" &&
    Array.isArray(result.items) &&
    Array.isArray(result.skipped) &&
    Array.isArray(o.spots)
  );
}

/** 保存されている JSON 文字列（無ければ null）。useSyncExternalStore のスナップショットに使う */
export function readPlanSessionRaw(listId: string): string | null {
  const s = storage();
  if (!s) return null;
  try {
    return s.getItem(planSessionKey(listId));
  } catch {
    return null;
  }
}

export function parsePlanSession(raw: string | null): PlanSession | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPlanSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function loadPlanSession(listId: string): PlanSession | null {
  return parsePlanSession(readPlanSessionRaw(listId));
}

export function clearPlanSession(listId: string): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(planSessionKey(listId));
  } catch {
    // 無視
  }
}
