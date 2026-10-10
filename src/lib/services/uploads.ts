/**
 * POST /uploads の業務ロジック（F-2-4、Q4）。
 * - 停止中（post_create）なら 503。
 * - Storage の一時パス（posts/tmp/{userId}/...）への署名付きアップロード先を発行する。
 * Repository の実装には依存しない（テストでは Memory Repository を渡す）。
 */
import { ApiError } from "@/lib/api/errors";
import type { UploadsResponse } from "@/lib/domain/types";
import { isSuspended, suspendedMessage } from "@/lib/external/usage";
import type { Repository } from "@/lib/repo/types";
import type { UploadRequest } from "@/lib/validation/schemas";

export async function requestUploads(
  repo: Repository,
  userId: string,
  input: UploadRequest,
): Promise<UploadsResponse> {
  if (await isSuspended(repo.apiUsage, "post_create")) {
    throw ApiError.suspended("post_create", suspendedMessage("post_create"));
  }
  const uploads = await repo.storage.createSignedUploads(userId, input.files);
  return { uploads };
}
