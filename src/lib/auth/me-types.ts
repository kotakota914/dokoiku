/** GET /api/v1/me のレスポンス（画面・API 共用の型。ブラウザから import してよい） */
import type { Profile } from "@/lib/domain/types";

export interface MeResponse {
  user: { id: string; email: string | null; isAdmin: boolean };
  profile: Profile | null;
}
