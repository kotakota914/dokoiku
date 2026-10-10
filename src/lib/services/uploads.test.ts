/**
 * POST /uploads の service を Memory Repository で検証する。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { ApiError } = await import("@/lib/api/errors");
const { LIMITS, USAGE_LIMITS } = await import("@/lib/domain/constants");
const { createMemoryRepository, SEED_USER_IDS } = await import("@/lib/repo/memory");
const { periodKey } = await import("@/lib/utils/time");
const { requestUploads } = await import("./uploads");

describe("requestUploads", () => {
  it("本人の tmp 配下への署名付きアップロード先を files と同じ順で返す", async () => {
    const repo = createMemoryRepository(true, { persist: false });
    const me = SEED_USER_IDS.userA;
    const { uploads } = await requestUploads(repo, me, {
      files: [
        { kind: "full", contentType: "image/webp", size: 400_000 },
        { kind: "thumb", contentType: "image/webp", size: 30_000 },
      ],
    });
    expect(uploads).toHaveLength(2);
    expect(uploads.map((u) => u.kind)).toEqual(["full", "thumb"]);
    expect(uploads.every((u) => u.path.startsWith(`posts/tmp/${me}/`))).toBe(true);
    expect(uploads.every((u) => typeof u.signedUrl === "string" && u.signedUrl.length > 0)).toBe(true);
  });

  it("変換後サイズが 2MB を超える申告は 413 PAYLOAD_TOO_LARGE（9.1）", async () => {
    const repo = createMemoryRepository(true, { persist: false });
    const createSignedUploads = vi.spyOn(repo.storage, "createSignedUploads");
    const err = await requestUploads(repo, SEED_USER_IDS.userA, {
      files: [
        { kind: "full", contentType: "image/webp", size: LIMITS.convertedImageMaxBytes },
        { kind: "thumb", contentType: "image/webp", size: LIMITS.convertedImageMaxBytes + 1 },
      ],
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 413, code: "PAYLOAD_TOO_LARGE" });
    expect((err as InstanceType<typeof ApiError>).details).toEqual([
      { field: "files.1.size", reason: "max_size" },
    ]);
    expect(createSignedUploads).not.toHaveBeenCalled();
  });

  it("停止中（post_create）は 503", async () => {
    const repo = createMemoryRepository(true, { persist: false });
    const { provider, feature, limit } = USAGE_LIMITS.supabase_db;
    const period = periodKey("month");
    await repo.apiUsage.set(provider, feature, period, limit, limit);
    await repo.apiUsage.setSuspended(provider, feature, period, "2026-10-10T00:00:00.000+09:00");
    const createSignedUploads = vi.spyOn(repo.storage, "createSignedUploads");
    await expect(
      requestUploads(repo, SEED_USER_IDS.userA, {
        files: [{ kind: "full", contentType: "image/jpeg", size: 1 }],
      }),
    ).rejects.toMatchObject({ status: 503, code: "FEATURE_SUSPENDED", details: { feature: "post_create" } });
    await expect(
      requestUploads(repo, SEED_USER_IDS.userA, {
        files: [{ kind: "full", contentType: "image/jpeg", size: 1 }],
      }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(createSignedUploads).not.toHaveBeenCalled();
  });
});
