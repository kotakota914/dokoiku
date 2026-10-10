/**
 * F-8：無料枠管理（自動停止）。
 * - 外部 API を呼ぶ前に checkAndCount() で回数を数え、無料枠の 80%（USAGE_SUSPEND_RATIO）に達したら
 *   停止にして ApiError.suspended（503 FEATURE_SUSPENDED）を投げる。
 * - 期間（日・月）ごとに記録するので、期間が切り替わると自動で再開する（F-8-4）。
 * - 日単位の上限があるものは、停止判定に使う日の行に加えて年月の行にも回数を記録する（F-8-1。api-10）。
 * - Supabase の容量（Q4 / ADR-0015）は外部ジョブが絶対値を recordAbsoluteUsage() で書き込む。
 *
 * Repository の実装は import せず、ApiUsageRepo の契約だけに依存する。
 */
import { ApiError } from "@/lib/api/errors";
import { serverConfig } from "@/lib/config";
import {
  FEATURE_LABELS,
  USAGE_LIMITS,
  USAGE_SUSPEND_RATIO,
  type Feature,
  type UsageKey,
} from "@/lib/domain/constants";
import type { ApiUsage, SystemStatus } from "@/lib/domain/types";
import type { ApiUsageRepo } from "@/lib/repo/types";
import { nowIso, periodKey } from "@/lib/utils/time";
import { notify as defaultNotify, type NotifyLevel } from "./notify";

export interface UsageDeps {
  /** テストで時刻を固定する */
  now?: Date;
  /** テストで通知を差し替える */
  notify?: (message: string, level?: NotifyLevel) => Promise<void>;
}

/** 停止のしきい値（回数） */
export function suspendThreshold(limit: number): number {
  return Math.ceil(limit * USAGE_SUSPEND_RATIO);
}

/** そのキーの現在の期間（day: 2026-10-10、month: 2026-10） */
export function periodFor(key: UsageKey, now = new Date()): string {
  return periodKey(USAGE_LIMITS[key].period, now);
}

export function suspendedMessage(feature: Feature): string {
  return `現在、${FEATURE_LABELS[feature]}は利用できません（無料枠の上限に近づいたため）`;
}

function describe(key: UsageKey, usage: ApiUsage): string {
  const { provider, feature } = USAGE_LIMITS[key];
  return `${provider}/${feature}（${FEATURE_LABELS[feature]}）期間 ${usage.period}：${usage.count} / ${usage.limit}`;
}

/**
 * 回数を加算し、しきい値に達していれば停止にして例外を投げる。
 * すでに停止中なら加算せずに例外を投げる（F-8-2「呼び出さず」）。
 * 戻り値は加算後の使用量。
 */
export async function checkAndCount(
  repo: ApiUsageRepo,
  key: UsageKey,
  by = 1,
  deps: UsageDeps = {},
): Promise<ApiUsage> {
  const { provider, feature, limit } = USAGE_LIMITS[key];
  const now = deps.now ?? new Date();
  const notify = deps.notify ?? defaultNotify;
  const period = periodFor(key, now);

  const current = await repo.get(provider, feature, period);
  if (current?.suspendedAt) throw ApiError.suspended(feature, suspendedMessage(feature));

  const usage = await repo.increment(provider, feature, period, limit, by);
  // F-8-1：年月ごとの累計も残す（日単位のキーだけ。停止判定には使わない）
  if (USAGE_LIMITS[key].period === "day") {
    await repo.increment(provider, feature, periodKey("month", now), limit, by);
  }
  if (usage.count >= suspendThreshold(usage.limit)) {
    if (!usage.suspendedAt) {
      await repo.setSuspended(provider, feature, period, nowIso(now));
      await notify(
        `無料枠の ${Math.round(USAGE_SUSPEND_RATIO * 100)}% に達したため ${FEATURE_LABELS[feature]} を停止しました。${describe(key, usage)}`,
        "warn",
      );
    }
    throw ApiError.suspended(feature, suspendedMessage(feature));
  }
  return usage;
}

/** 現在の日・月の期間で、その機能が停止中か */
export async function isSuspended(repo: ApiUsageRepo, feature: Feature, now = new Date()): Promise<boolean> {
  const list = await repo.listSuspended([periodKey("day", now), periodKey("month", now)]);
  return list.some((s) => s.feature === feature);
}

/** 停止中なら ApiError.suspended を投げる（API の入口で使う） */
export async function assertNotSuspended(
  repo: ApiUsageRepo,
  feature: Feature,
  now = new Date(),
): Promise<void> {
  if (await isSuspended(repo, feature, now)) throw ApiError.suspended(feature, suspendedMessage(feature));
}

/** GET /system/status */
export async function getSystemStatus(repo: ApiUsageRepo, now = new Date()): Promise<SystemStatus> {
  const suspended = await repo.listSuspended([periodKey("day", now), periodKey("month", now)]);
  return {
    suspended,
    capabilities: {
      externalSearch: serverConfig.nominatimEnabled,
      routing: !!serverConfig.orsApiKey,
      googleLogin: serverConfig.backend === "supabase",
      backend: serverConfig.backend,
    },
  };
}

/**
 * 使用量を絶対値で記録する（Supabase の DB・Storage 容量など。Q4 / ADR-0015）。
 * 80% 以上なら停止＋通知、下回れば再開＋通知。変化がなければ何もしない。
 */
export async function recordAbsoluteUsage(
  repo: ApiUsageRepo,
  key: UsageKey,
  count: number,
  deps: UsageDeps = {},
): Promise<{ usage: ApiUsage; suspended: boolean; changed: boolean }> {
  const { provider, feature, limit } = USAGE_LIMITS[key];
  const now = deps.now ?? new Date();
  const notify = deps.notify ?? defaultNotify;
  const period = periodFor(key, now);

  const usage = await repo.set(provider, feature, period, count, limit);
  const over = count >= suspendThreshold(usage.limit);
  const wasSuspended = !!usage.suspendedAt;
  if (over && !wasSuspended) {
    const at = nowIso(now);
    await repo.setSuspended(provider, feature, period, at);
    await notify(
      `無料枠の ${Math.round(USAGE_SUSPEND_RATIO * 100)}% に達したため ${FEATURE_LABELS[feature]} を停止しました。${describe(key, usage)}`,
      "warn",
    );
    return { usage: { ...usage, suspendedAt: at }, suspended: true, changed: true };
  }
  if (!over && wasSuspended) {
    await repo.setSuspended(provider, feature, period, null);
    await notify(
      `使用量が下がったため ${FEATURE_LABELS[feature]} を再開しました。${describe(key, usage)}`,
      "info",
    );
    return { usage: { ...usage, suspendedAt: null }, suspended: false, changed: true };
  }
  return { usage, suspended: wasSuspended, changed: false };
}
