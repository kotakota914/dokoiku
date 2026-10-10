/**
 * PUT /api/dev/uploads?path=...&token=...
 * memory モード専用の画像アップロード先（Supabase Storage の署名付き URL の代わり）。
 * storage.createSignedUploads が発行したトークンを検証し、<dataDir>/uploads/<path> に保存する。
 */
import { z } from "zod";
import { LIMITS } from "@/lib/domain/constants";
import { getDataBackend } from "@/lib/config";
import { ApiError } from "@/lib/api/errors";
import { json, parseQuery, route } from "@/lib/api/handler";
import { getMemoryRepository } from "@/lib/repo/memory";

const ALLOWED_TYPES = ["image/webp", "image/jpeg"] as const;

const querySchema = z.object({
  path: z
    .string()
    .min(1)
    .max(300)
    .refine((p) => p.startsWith("posts/tmp/") && !p.includes("..") && !p.includes("\\"), {
      message: "アップロード先のパスが正しくありません",
    }),
  token: z.string().min(1).max(100),
});

export const PUT = route(async (req) => {
  if (getDataBackend() !== "memory") throw ApiError.notFound();
  const { path, token } = parseQuery(req, querySchema);
  const repo = getMemoryRepository();
  if (!repo.verifyUploadToken(path, token)) {
    throw ApiError.forbidden("アップロード先が無効か、有効期限が切れています");
  }

  const contentType = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!(ALLOWED_TYPES as readonly string[]).includes(contentType)) {
    throw ApiError.validation("画像は WebP または JPEG で送ってください");
  }
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > LIMITS.convertedImageMaxBytes) {
    throw new ApiError("PAYLOAD_TOO_LARGE", "変換後の画像は1枚あたり2MB以内にしてください");
  }
  const body = new Uint8Array(await req.arrayBuffer());
  if (body.byteLength === 0) throw ApiError.validation("画像データが空です");
  if (body.byteLength > LIMITS.convertedImageMaxBytes) {
    throw new ApiError("PAYLOAD_TOO_LARGE", "変換後の画像は1枚あたり2MB以内にしてください");
  }

  await repo.writeUploadFile(path, body);
  return json({ ok: true, path, size: body.byteLength });
});
