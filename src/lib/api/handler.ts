import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType, type z } from "zod";
import { ApiError } from "./errors";

/**
 * zod の issue.code を 9.1 の details[].reason（業務的な理由名）へ対応付ける。
 * too_big → max_length、too_small → min_length、値が無い invalid_type → required、それ以外 → invalid
 */
export function zodIssueReason(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case "too_big":
      return "max_length";
    case "too_small":
      return "min_length";
    case "invalid_type":
      return issue.message.endsWith("received undefined") ? "required" : "invalid";
    default:
      return "invalid";
  }
}

type Ctx<P> = { params: Promise<P> };
type Handler<P> = (req: NextRequest, ctx: Ctx<P>) => Promise<Response> | Response;

/**
 * Route Handler の共通ラッパー。ApiError / ZodError を 9.1 のエラー形式に変換する。
 *
 * 使い方:
 *   export const GET = route<{ spotId: string }>(async (req, { params }) => {
 *     const { spotId } = await params;
 *     ...
 *     return json(data);
 *   });
 */
export function route<P = Record<string, never>>(handler: Handler<P>) {
  return async (req: NextRequest, ctx: Ctx<P>): Promise<Response> => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      return errorToResponse(err);
    }
  };
}

export function errorToResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    return NextResponse.json(err.toBody(), { status: err.status });
  }
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({
      field: i.path.join("."),
      reason: zodIssueReason(i),
      message: i.message,
    }));
    const first = err.issues[0]?.message ?? "入力値が正しくありません";
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: first, details } },
      { status: 400 },
    );
  }
  console.error("[api] unhandled error", err);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "サーバーでエラーが発生しました" } },
    { status: 500 },
  );
}

export function json<T>(data: T, init?: ResponseInit): Response {
  return NextResponse.json(data, init);
}

export function created<T>(data: T): Response {
  return NextResponse.json(data, { status: 201 });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

/** JSON ボディを zod で検証する。不正なら ZodError（→400） */
export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw ApiError.validation("リクエストの形式が正しくありません（JSON を送ってください）");
  }
  return schema.parse(raw);
}

/** クエリ文字列を zod で検証する */
export function parseQuery<T>(req: NextRequest, schema: ZodType<T>): T {
  const obj: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((v, k) => {
    obj[k] = v;
  });
  return schema.parse(obj);
}
