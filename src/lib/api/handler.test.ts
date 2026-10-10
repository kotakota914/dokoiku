/**
 * handler.ts のエラー変換（9.1 のエラー形式）。zod の issue.code を業務的な reason に対応付ける。
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

const { ApiError } = await import("@/lib/api/errors");
const { errorToResponse, zodIssueReason } = await import("./handler");

describe("errorToResponse", () => {
  it("ZodError は 400 VALIDATION_ERROR で、reason は max_length / min_length / required / invalid", async () => {
    const schema = z.object({
      comment: z.string().max(2),
      name: z.string().min(1),
      spotId: z.string(),
      category: z.enum(["a"]),
      url: z.string().url(),
    });
    const parsed = schema.safeParse({ comment: "xxx", name: "", category: "b", url: "nope" });
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error("unreachable");
    const res = errorToResponse(parsed.error);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details).toEqual([
      { field: "comment", reason: "max_length", message: expect.any(String) },
      { field: "name", reason: "min_length", message: expect.any(String) },
      { field: "spotId", reason: "required", message: expect.any(String) },
      { field: "category", reason: "invalid", message: expect.any(String) },
      { field: "url", reason: "invalid", message: expect.any(String) },
    ]);
    expect(zodIssueReason({ code: "custom", path: [], message: "x" })).toBe("invalid");
  });

  it("ApiError はその status と body、それ以外は 500 INTERNAL_ERROR", async () => {
    const res = errorToResponse(ApiError.conflict("重複", { reason: "dup" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: "CONFLICT", message: "重複", details: { reason: "dup" } },
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const unknown = errorToResponse(new Error("boom"));
    expect(unknown.status).toBe(500);
    expect((await unknown.json()).error.code).toBe("INTERNAL_ERROR");
  });
});
