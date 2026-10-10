import { describe, expect, it } from "vitest";
import { ApiClientError } from "@/lib/api/client";
import { hasImageIssue, isImageUploadError } from "./uploadError";

describe("uploadError", () => {
  it("details に field: images があれば画像の問題（upload_missing / invalid_path）", () => {
    expect(hasImageIssue([{ field: "images", reason: "upload_missing" }])).toBe(true);
    expect(hasImageIssue([{ field: "images", reason: "invalid_path", index: 1 }])).toBe(true);
    expect(hasImageIssue([{ field: "comment", reason: "too_long" }])).toBe(false);
    expect(hasImageIssue(undefined)).toBe(false);
    expect(hasImageIssue({ field: "images" })).toBe(false);
  });

  it("isImageUploadError は VALIDATION_ERROR かつ images の details のときだけ true", () => {
    const err = new ApiClientError(400, {
      code: "VALIDATION_ERROR",
      message: "画像が見つかりません",
      details: [{ field: "images", reason: "upload_missing" }],
    });
    expect(isImageUploadError(err)).toBe(true);
    expect(
      isImageUploadError(new ApiClientError(400, { code: "VALIDATION_ERROR", message: "x", details: [] })),
    ).toBe(false);
    expect(
      isImageUploadError(
        new ApiClientError(404, { code: "NOT_FOUND", message: "x", details: [{ field: "images" }] }),
      ),
    ).toBe(false);
    expect(isImageUploadError(new Error("x"))).toBe(false);
  });
});
