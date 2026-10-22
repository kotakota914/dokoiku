/**
 * 経路作成の画面間（S-09 → S-10 → S-11）の受け渡しをブラウザの sessionStorage で行う。
 * - 下書き（PlanDraft）：S-09 で入力した対象スポット・共通の条件・作り方。S-10 と「条件を変える」で使う
 * - 結果（PlanSession）：POST /plans/compute の応答（最大 3 案）と、選んでいる案
 * 会話（AIと相談）の本文は保存しない（v0.3 Q3）。
 */
import { PLAN_DEFAULTS, TRAVEL_MODE_DEFAULT, type PlanMethod, type TravelMode } from "@/lib/domain/constants";
import type {
  PlanComputeResponse,
  PlanParams,
  PlanPlace,
  PlanPreferences,
  SpotSummary,
} from "@/lib/domain/types";

/** S-09 の入力内容（未検証の下書き） */
export interface PlanDraft {
  spotIds: string[];
  origin: PlanPlace | null;
  destination: PlanPlace | null;
  date: string;
  startTime: string;
  endTime: string;
  mode: TravelMode;
  lunchBreak: boolean;
  method: PlanMethod;
  preferences: PlanPreferences;
}

/** S-11 で表示する計算結果 */
export interface PlanSession {
  params: PlanParams;
  response: PlanComputeResponse;
  /** params.spotIds に対応するスポットの要約（結果画面で名前・座標を引くため） */
  spots: SpotSummary[];
  /** 選んでいる案の id（無ければ先頭） */
  selectedId: string | null;
}

export const DEFAULT_PREFERENCES: PlanPreferences = {
  pace: "normal",
  interests: [],
  priority: "fewer_moves",
  timeWindows: [],
  orderHints: [],
  exclude: [],
};

export const PLAN_SESSION_KEY_PREFIX = "dokoiko.plan.";
const DRAFT_KEY_PREFIX = "dokoiko.plan-draft.";

export function planSessionKey(listId: string): string {
  return `${PLAN_SESSION_KEY_PREFIX}${listId}`;
}

export function planDraftKey(listId: string): string {
  return `${DRAFT_KEY_PREFIX}${listId}`;
}

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): boolean {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function readRaw(key: string): string | null {
  const s = storage();
  if (!s) return null;
  try {
    return s.getItem(key);
  } catch {
    return null;
  }
}

function remove(key: string): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(key);
  } catch {
    // 無視
  }
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

// ---------- 結果 ----------

function isPlanSession(v: unknown): v is PlanSession {
  if (!isObject(v)) return false;
  const params = v.params;
  const response = v.response;
  return (
    isObject(params) &&
    Array.isArray(params.spotIds) &&
    isObject(response) &&
    Array.isArray(response.candidates) &&
    typeof response.travelMatrixId === "string" &&
    response.candidates.every(
      (c) =>
        isObject(c) &&
        typeof c.id === "string" &&
        Array.isArray(c.items) &&
        Array.isArray(c.skipped) &&
        isObject(c.stats),
    ) &&
    Array.isArray(v.spots)
  );
}

export function savePlanSession(listId: string, session: PlanSession): boolean {
  return write(planSessionKey(listId), session);
}

/** 保存されている JSON 文字列（無ければ null）。useSyncExternalStore のスナップショットに使う */
export function readPlanSessionRaw(listId: string): string | null {
  return readRaw(planSessionKey(listId));
}

export function parsePlanSession(raw: string | null): PlanSession | null {
  const parsed = parseJson(raw);
  if (!isPlanSession(parsed)) return null;
  return { ...parsed, selectedId: typeof parsed.selectedId === "string" ? parsed.selectedId : null };
}

export function loadPlanSession(listId: string): PlanSession | null {
  return parsePlanSession(readPlanSessionRaw(listId));
}

export function clearPlanSession(listId: string): void {
  remove(planSessionKey(listId));
}

// ---------- 下書き ----------

function isPlanDraft(v: unknown): v is PlanDraft {
  if (!isObject(v)) return false;
  return (
    Array.isArray(v.spotIds) &&
    v.spotIds.every((id) => typeof id === "string") &&
    typeof v.date === "string" &&
    typeof v.startTime === "string" &&
    typeof v.endTime === "string" &&
    typeof v.mode === "string" &&
    typeof v.method === "string" &&
    isObject(v.preferences)
  );
}

export function savePlanDraft(listId: string, draft: PlanDraft): boolean {
  return write(planDraftKey(listId), draft);
}

export function readPlanDraftRaw(listId: string): string | null {
  return readRaw(planDraftKey(listId));
}

export function parsePlanDraft(raw: string | null): PlanDraft | null {
  const parsed = parseJson(raw);
  if (!isPlanDraft(parsed)) return null;
  return {
    ...parsed,
    origin: isObject(parsed.origin) ? parsed.origin : null,
    destination: isObject(parsed.destination) ? parsed.destination : null,
    lunchBreak: parsed.lunchBreak !== false,
    preferences: { ...DEFAULT_PREFERENCES, ...parsed.preferences },
  };
}

export function loadPlanDraft(listId: string): PlanDraft | null {
  return parsePlanDraft(readPlanDraftRaw(listId));
}

export function clearPlanDraft(listId: string): void {
  remove(planDraftKey(listId));
}

/** 下書きの既定値（日付は呼び出し側で決める） */
export function defaultDraft(date: string): Omit<PlanDraft, "spotIds" | "origin"> {
  return {
    destination: null,
    date,
    startTime: PLAN_DEFAULTS.startTime,
    endTime: PLAN_DEFAULTS.endTime,
    mode: TRAVEL_MODE_DEFAULT,
    lunchBreak: true,
    method: "auto",
    preferences: DEFAULT_PREFERENCES,
  };
}

/** storage イベント（別タブ）を購読する。useSyncExternalStore 用 */
export function subscribeStorage(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/** サーバー・ハイドレーション中は undefined（読み込み中）を返すためのスナップショット */
export function getServerSnapshot(): string | null | undefined {
  return undefined;
}
