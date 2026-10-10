import type { ApiErrorBody, ApiErrorCode } from "@/lib/domain/types";

const STATUS: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  UPSTREAM_ERROR: 502,
  FEATURE_SUSPENDED: 503,
  INTERNAL_ERROR: 500,
};

/** API が返す業務エラー。Route Handler では throw するだけでよい（handler.ts が JSON にする） */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }

  toBody(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }

  static unauthorized(message = "ログインが必要です") {
    return new ApiError("UNAUTHORIZED", message);
  }
  static forbidden(message = "この操作を行う権限がありません") {
    return new ApiError("FORBIDDEN", message);
  }
  static notFound(message = "対象が見つかりませんでした") {
    return new ApiError("NOT_FOUND", message);
  }
  static conflict(message: string, details?: unknown) {
    return new ApiError("CONFLICT", message, details);
  }
  static validation(message: string, details?: unknown) {
    return new ApiError("VALIDATION_ERROR", message, details);
  }
  static rateLimited(message = "操作が多すぎます。しばらく待ってからもう一度お試しください") {
    return new ApiError("RATE_LIMITED", message);
  }
  static upstream(message = "外部サービスでエラーが発生しました") {
    return new ApiError("UPSTREAM_ERROR", message);
  }
  static suspended(feature: string, message?: string) {
    return new ApiError(
      "FEATURE_SUSPENDED",
      message ?? "無料枠の上限に近づいたため、この機能は現在利用できません",
      { feature },
    );
  }
}
