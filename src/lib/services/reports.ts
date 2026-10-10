/**
 * 通報の業務ロジック（F-7-1、F-7-2、F-7-3、Q13）。
 * - 自分の投稿は通報できない（403）。同じ投稿への二重通報は 409。
 * - 通報が LIMITS.reportAutoHideCount 件以上になったら自動で非表示にし、スポットの統計を更新する。
 */
import { ApiError } from "@/lib/api/errors";
import { LIMITS } from "@/lib/domain/constants";
import type { Page, PostView, Report } from "@/lib/domain/types";
import type { Paging, Repository } from "@/lib/repo/types";
import type { createReportSchema } from "@/lib/validation/schemas";
import type { z } from "zod";

export type CreateReportInput = z.infer<typeof createReportSchema>;

export interface ReportResult {
  /** この投稿の通報数（未処理） */
  count: number;
  /** この通報で自動非表示になったか、またはすでに非表示か */
  hidden: boolean;
}

/** POST /posts/{postId}/reports */
export async function reportPost(
  repo: Repository,
  reporterId: string,
  postId: string,
  input: CreateReportInput,
): Promise<ReportResult> {
  const post = await repo.posts.getById(postId, reporterId);
  if (!post) throw ApiError.notFound("この投稿は見つかりませんでした");
  if (post.userId === reporterId) throw ApiError.forbidden("自分の投稿は通報できません");

  const { created, count } = await repo.reports.create({
    postId,
    reporterId,
    reason: input.reason,
    note: input.note ? input.note : null,
  });
  if (!created) throw ApiError.conflict("すでに通報済みです");

  let hidden = post.status === "hidden";
  if (!hidden && count >= LIMITS.reportAutoHideCount) {
    await repo.posts.setStatus(postId, "hidden");
    await repo.spots.recomputeStats(post.spotId);
    hidden = true;
  }
  return { count, hidden };
}

/** GET /admin/reports：未処理の通報を新しい順に */
export async function listOpenReports(
  repo: Repository,
  paging: Paging,
): Promise<Page<Report & { post: PostView | null }>> {
  return repo.reports.listOpen(paging);
}
