import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { USAGE_LIMITS } from "@/lib/domain/constants";
import type { ApiUsage, SuspendedFeature } from "@/lib/domain/types";
import type { ApiUsageRepo } from "@/lib/repo/types";
import type { NotifyLevel } from "./notify";
import {
  checkAndCount,
  getSystemStatus,
  isSuspended,
  periodFor,
  recordAbsoluteUsage,
  suspendThreshold,
} from "./usage";

type NotifyFn = (message: string, level?: NotifyLevel) => Promise<void>;
const notifySpy = () => vi.fn<NotifyFn>(async () => {});

/** ApiUsageRepo だけを満たす小さな偽物 */
function fakeUsageRepo(): ApiUsageRepo & { rows: Map<string, ApiUsage> } {
  const rows = new Map<string, ApiUsage>();
  const k = (p: string, f: string, period: string) => `${p}/${f}/${period}`;
  return {
    rows,
    get: async (p, f, period) => rows.get(k(p, f, period)) ?? null,
    increment: async (p, f, period, limit, by = 1) => {
      const key = k(p, f, period);
      const row = rows.get(key) ?? { provider: p, feature: f, period, count: 0, limit, suspendedAt: null };
      row.count += by;
      rows.set(key, row);
      return { ...row };
    },
    set: async (p, f, period, count, limit) => {
      const key = k(p, f, period);
      const row = rows.get(key) ?? { provider: p, feature: f, period, count: 0, limit, suspendedAt: null };
      row.count = count;
      row.limit = limit;
      rows.set(key, row);
      return { ...row };
    },
    setSuspended: async (p, f, period, at) => {
      const row = rows.get(k(p, f, period));
      if (row) row.suspendedAt = at;
    },
    listSuspended: async (periods): Promise<SuspendedFeature[]> =>
      [...rows.values()]
        .filter((r) => r.suspendedAt && periods.includes(r.period))
        .map((r) => ({
          feature: r.feature,
          provider: r.provider,
          period: r.period,
          count: r.count,
          limit: r.limit,
          suspendedAt: r.suspendedAt!,
        })),
  };
}

const NOW = new Date("2026-10-10T03:00:00Z"); // JST 12:00

describe("periodFor", () => {
  it("日単位・月単位の期間キー（日本時間）", () => {
    expect(periodFor("ors_matrix", NOW)).toBe("2026-10-10");
    expect(periodFor("supabase_storage", NOW)).toBe("2026-10");
    // UTC 15:00 は JST では翌日
    expect(periodFor("nominatim", new Date("2026-10-10T15:30:00Z"))).toBe("2026-10-11");
  });
});

describe("checkAndCount", () => {
  it("回数を加算して返す", async () => {
    const repo = fakeUsageRepo();
    const notify = notifySpy();
    const u = await checkAndCount(repo, "ors_matrix", 1, { now: NOW, notify });
    expect(u.count).toBe(1);
    expect(u.limit).toBe(USAGE_LIMITS.ors_matrix.limit);
    expect(notify).not.toHaveBeenCalled();
  });

  it("80% に達したら停止・通知して FEATURE_SUSPENDED を投げる", async () => {
    const repo = fakeUsageRepo();
    const notify = notifySpy();
    const { provider, feature, limit } = USAGE_LIMITS.ors_matrix;
    const period = periodFor("ors_matrix", NOW);
    await repo.set(provider, feature, period, suspendThreshold(limit) - 1, limit);

    await expect(checkAndCount(repo, "ors_matrix", 1, { now: NOW, notify })).rejects.toMatchObject({
      code: "FEATURE_SUSPENDED",
      status: 503,
      details: { feature: "route_planning" },
    });
    const row = await repo.get(provider, feature, period);
    expect(row?.count).toBe(suspendThreshold(limit));
    expect(row?.suspendedAt).toBeTruthy();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toContain("停止");
    expect(notify.mock.calls[0][1]).toBe("warn");
  });

  it("すでに停止中なら加算せず通知もせずに投げる", async () => {
    const repo = fakeUsageRepo();
    const notify = notifySpy();
    const { provider, feature, limit } = USAGE_LIMITS.nominatim;
    const period = periodFor("nominatim", NOW);
    await repo.set(provider, feature, period, 400, limit);
    await repo.setSuspended(provider, feature, period, "2026-10-10T10:00:00.000+09:00");

    const err = await checkAndCount(repo, "nominatim", 1, { now: NOW, notify }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("FEATURE_SUSPENDED");
    expect(err.message).toContain("外部の場所検索");
    expect((await repo.get(provider, feature, period))?.count).toBe(400);
    expect(notify).not.toHaveBeenCalled();
  });

  it("日単位の上限があるキーは年月の行にも回数を記録する（F-8-1）。停止判定は日の行だけ", async () => {
    const repo = fakeUsageRepo();
    const notify = notifySpy();
    const { provider, feature, limit } = USAGE_LIMITS.ors_matrix;
    await checkAndCount(repo, "ors_matrix", 1, { now: NOW, notify });
    await checkAndCount(repo, "ors_matrix", 2, { now: NOW, notify });
    expect((await repo.get(provider, feature, "2026-10-10"))?.count).toBe(3);
    expect((await repo.get(provider, feature, "2026-10"))?.count).toBe(3);

    // 月の行がしきい値を超えていても停止しない（日の行で判定する）
    await repo.set(provider, feature, "2026-10", limit, limit);
    const u = await checkAndCount(repo, "ors_matrix", 1, { now: NOW, notify });
    expect(u.period).toBe("2026-10-10");
    expect(u.count).toBe(4);
    expect((await repo.get(provider, feature, "2026-10"))?.suspendedAt).toBeNull();
    expect(await isSuspended(repo, "route_planning", NOW)).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  it("期間が切り替わると自動で再開する（別の期間は別の行）", async () => {
    const repo = fakeUsageRepo();
    const notify = notifySpy();
    const { provider, feature, limit } = USAGE_LIMITS.ors_directions;
    await repo.set(provider, feature, "2026-10-09", limit, limit);
    await repo.setSuspended(provider, feature, "2026-10-09", "2026-10-09T10:00:00.000+09:00");
    const u = await checkAndCount(repo, "ors_directions", 1, { now: NOW, notify });
    expect(u.period).toBe("2026-10-10");
    expect(u.count).toBe(1);
  });
});

describe("isSuspended / getSystemStatus", () => {
  it("現在の日・月の期間で停止中のものだけを返す", async () => {
    const repo = fakeUsageRepo();
    await repo.set("ors", "route_planning", "2026-10-10", 400, 500);
    await repo.setSuspended("ors", "route_planning", "2026-10-10", "2026-10-10T10:00:00.000+09:00");
    await repo.set("supabase", "post_create", "2026-09", 1, 1);
    await repo.setSuspended("supabase", "post_create", "2026-09", "2026-09-30T10:00:00.000+09:00");

    expect(await isSuspended(repo, "route_planning", NOW)).toBe(true);
    expect(await isSuspended(repo, "post_create", NOW)).toBe(false);
    expect(await isSuspended(repo, "external_search", NOW)).toBe(false);

    const status = await getSystemStatus(repo, NOW);
    expect(status.suspended.map((s) => s.feature)).toEqual(["route_planning"]);
    expect(status.capabilities.backend).toBe("memory");
    expect(status.capabilities.googleLogin).toBe(false);
    expect(typeof status.capabilities.routing).toBe("boolean");
    expect(typeof status.capabilities.externalSearch).toBe("boolean");
  });
});

describe("recordAbsoluteUsage（Q4：Supabase の容量）", () => {
  it("80% を超えたら停止して通知、下回れば再開して通知、変化がなければ何もしない", async () => {
    const repo = fakeUsageRepo();
    const notify = notifySpy();
    const { limit } = USAGE_LIMITS.supabase_storage;

    const r1 = await recordAbsoluteUsage(repo, "supabase_storage", Math.floor(limit * 0.5), {
      now: NOW,
      notify,
    });
    expect(r1).toMatchObject({ suspended: false, changed: false });
    expect(notify).not.toHaveBeenCalled();

    const r2 = await recordAbsoluteUsage(repo, "supabase_storage", Math.ceil(limit * 0.85), {
      now: NOW,
      notify,
    });
    expect(r2).toMatchObject({ suspended: true, changed: true });
    expect(r2.usage.suspendedAt).toBeTruthy();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][1]).toBe("warn");
    expect(await isSuspended(repo, "post_create", NOW)).toBe(true);

    // 停止中のまま（通知は増えない）
    const r3 = await recordAbsoluteUsage(repo, "supabase_storage", Math.ceil(limit * 0.9), {
      now: NOW,
      notify,
    });
    expect(r3).toMatchObject({ suspended: true, changed: false });
    expect(notify).toHaveBeenCalledTimes(1);

    const r4 = await recordAbsoluteUsage(repo, "supabase_storage", Math.floor(limit * 0.5), {
      now: NOW,
      notify,
    });
    expect(r4).toMatchObject({ suspended: false, changed: true });
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls[1][0]).toContain("再開");
    expect(notify.mock.calls[1][1]).toBe("info");
    expect(await isSuspended(repo, "post_create", NOW)).toBe(false);
  });
});
