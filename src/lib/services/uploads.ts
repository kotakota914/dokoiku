/**
 * POST /uploads の業務ロジック（F-2-4、Q4）。
 * - 変換後サイズが LIMITS.convertedImageMaxBytes（2MB）を超える申告は 413 PAYLOAD_TOO_LARGE（9.1）。
 * - 停止中（post_create）なら 503。
 * - Storage の一時パス（posts/tmp/{userId}/...）への署名付きアップロード先を発行する。
 * Repository の実装には依存しない（テストでは Memory Repository を渡す）。
 */
import { ApiError } from "@/lib/api/errors";
import { LIMITS } from "@/lib/domain/constants";
import type { UploadsResponse } from "@/lib/domain/types";
import { isSuspended, suspendedMessage } from "@/lib/external/usage";
import type { Repository } from "@/lib/repo/types";
import type { UploadRequest } from "@/lib/validation/schemas";

export async function requestUploads(
  repo: Repository,
  userId: string,
  input: UploadRequest,
): Promise<UploadsResponse> {
  const tooLarge = input.files
    .map((f, index) => ({ f, index }))
    .filter(({ f }) => f.size > LIMITS.convertedImageMaxBytes);
  if (tooLarge.length > 0) {
    throw new ApiError(
      "PAYLOAD_TOO_LARGE",
      "変換後の画像は1枚あたり2MB以内にしてください",
      tooLarge.map(({ index }) => ({ field: `files.${index}.size`, reason: "max_size" })),
    );
  }
  if (await isSuspended(repo.apiUsage, "post_create")) {
    throw ApiError.suspended("post_create", suspendedMessage("post_create"));
  }
  const uploads = await repo.storage.createSignedUploads(userId, input.files);
  return { uploads };
}
