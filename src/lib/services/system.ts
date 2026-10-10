/**
 * システム状態（F-8-5）。
 * Route Handler から呼ぶ純粋な関数。Repository の契約だけに依存し、"server-only" は import しない（vitest から直接テストするため）。
 */
import type { SystemStatus } from "@/lib/domain/types";
import { getSystemStatus as usageSystemStatus } from "@/lib/external/usage";
import type { Repository } from "@/lib/repo/types";

/** GET /system/status：停止中の機能と外部サービスの設定状況 */
export async function getStatus(repo: Pick<Repository, "apiUsage">, now = new Date()): Promise<SystemStatus> {
  return usageSystemStatus(repo.apiUsage, now);
}
