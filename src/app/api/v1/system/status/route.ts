/**
 * GET /api/v1/system/status（F-8-5）
 * 停止中の機能一覧と外部サービスの設定状況。ログイン不要。常に最新を返す（Cache-Control: no-store）。
 */
import { json, route } from "@/lib/api/handler";
import { getRepo } from "@/lib/repo";
import { getStatus } from "@/lib/services/system";

export const GET = route(async () => {
  const repo = await getRepo();
  const status = await getStatus(repo);
  return json(status, { headers: { "Cache-Control": "no-store" } });
});
