/** カーソル方式のページング（9.1）。`createdAt|id` を base64url にしたもの */
export interface CursorValue {
  createdAt: string;
  id: string;
}

export function encodeCursor(v: CursorValue): string {
  return Buffer.from(`${v.createdAt}|${v.id}`, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | undefined | null): CursorValue | null {
  if (!cursor) return null;
  try {
    const s = Buffer.from(cursor, "base64url").toString("utf8");
    const idx = s.lastIndexOf("|");
    if (idx <= 0) return null;
    return { createdAt: s.slice(0, idx), id: s.slice(idx + 1) };
  } catch {
    return null;
  }
}
