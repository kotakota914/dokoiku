"use client";

import { welcomeUrl } from "@/lib/auth/next-path";
import type { ApiErrorBody, ApiErrorCode } from "@/lib/domain/types";

/** ブラウザから API を呼ぶときのエラー。code で分岐できる */
export class ApiClientError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, body: ApiErrorBody["error"]) {
    super(body.message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }

  get isSuspended() {
    return this.code === "FEATURE_SUSPENDED";
  }
  get isUnauthorized() {
    return this.code === "UNAUTHORIZED";
  }
  /** 初回ログイン直後で表示名が未設定（/welcome 未完了）のため拒否された（F-6-2） */
  get isProfileRequired() {
    return (
      this.code === "FORBIDDEN" &&
      typeof this.details === "object" &&
      this.details !== null &&
      (this.details as { reason?: unknown }).reason === "profile_required"
    );
  }
}

/** プロフィール未作成のエラーを受けたら、現在のページを戻り先にして /welcome へ移動する */
function redirectToWelcome(): void {
  if (typeof window === "undefined") return;
  const { pathname, search, hash } = window.location;
  window.location.assign(welcomeUrl(`${pathname}${search}${hash}`));
}

const BASE = "/api/v1";

async function request<T>(method: string, path: string, body?: unknown, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
    ...init,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error ?? {
      code: "INTERNAL_ERROR" as ApiErrorCode,
      message: "通信に失敗しました",
    };
    const clientError = new ApiClientError(res.status, err);
    if (clientError.isProfileRequired) redirectToWelcome();
    throw clientError;
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, init?: RequestInit) => request<T>("GET", path, undefined, init),
  post: <T>(path: string, body?: unknown, init?: RequestInit) => request<T>("POST", path, body, init),
  put: <T>(path: string, body?: unknown, init?: RequestInit) => request<T>("PUT", path, body, init),
  patch: <T>(path: string, body?: unknown, init?: RequestInit) => request<T>("PATCH", path, body, init),
  delete: <T>(path: string, init?: RequestInit) => request<T>("DELETE", path, undefined, init),
};

/** エラーを画面向けの文言にする */
export function errorMessage(err: unknown, fallback = "エラーが発生しました"): string {
  if (err instanceof ApiClientError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
