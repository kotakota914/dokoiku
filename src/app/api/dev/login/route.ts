/**
 * POST /api/dev/login { userId }
 * memory モード専用の開発用ログイン。seed のユーザーなら Cookie を設定する。
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDataBackend } from "@/lib/config";
import { ApiError } from "@/lib/api/errors";
import { parseBody, route } from "@/lib/api/handler";
import { DEV_USER_COOKIE } from "@/lib/auth/server";
import { uuidSchema } from "@/lib/validation/schemas";
import { getMemoryRepository, SEED_USER_ID_LIST } from "@/lib/repo/memory";

const bodySchema = z.object({ userId: uuidSchema });

export const POST = route(async (req) => {
  if (getDataBackend() !== "memory") throw ApiError.notFound();
  const { userId } = await parseBody(req, bodySchema);
  if (!SEED_USER_ID_LIST.includes(userId)) throw ApiError.notFound("開発用ユーザーが見つかりませんでした");
  const profile = await getMemoryRepository().profiles.getById(userId);
  if (!profile) throw ApiError.notFound("開発用ユーザーが見つかりませんでした");

  const res = NextResponse.json({ ok: true, profile });
  res.cookies.set({
    name: DEV_USER_COOKIE,
    value: userId,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
});
