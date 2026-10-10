/**
 * POST /auth/signout
 * supabase モードはセッションを破棄、memory モードは開発用ログインの Cookie を削除して "/" へ戻す。
 * form の POST から呼ぶため 303 で GET へ誘導する。
 */
import { NextResponse, type NextRequest } from "next/server";
import { clearSession } from "@/lib/auth/session";

export async function POST(req: NextRequest) {
  try {
    await clearSession();
  } catch (err) {
    console.error("[auth/signout] 失敗しました", err instanceof Error ? err.message : err);
  }
  return NextResponse.redirect(new URL("/", req.url), { status: 303 });
}
