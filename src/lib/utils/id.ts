import { randomBytes, randomUUID } from "node:crypto";

export function newId(): string {
  return randomUUID();
}

/** 共有 URL 用トークン（ランダム32文字、URL セーフ） */
export function newShareToken(): string {
  return randomBytes(24).toString("base64url").slice(0, 32);
}
