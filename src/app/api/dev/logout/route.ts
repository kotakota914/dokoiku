/**
 * POST /api/dev/logout
 * memory モード専用。開発用ログインの Cookie を削除する。
 */
import { NextResponse } from "next/server";
import { getDataBackend } from "@/lib/config";
import { ApiError } from "@/lib/api/errors";
import { route } from "@/lib/api/handler";
import { DEV_USER_COOKIE } from "@/lib/auth/server";

export const POST = route(async () => {
  if (getDataBackend() !== "memory") throw ApiError.notFound();
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: DEV_USER_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
});
