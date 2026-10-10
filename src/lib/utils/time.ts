/** 時刻（HH:MM）と日本時間のユーティリティ（ブラウザ・サーバー共用） */
import { TIME_ZONE } from "@/lib/domain/constants";

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToHHMM(total: number): string {
  const t = Math.max(0, Math.round(total));
  const h = Math.floor(t / 60) % 24;
  const m = t % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** n 分単位に丸める（四捨五入） */
export function roundToStep(minutes: number, step: number): number {
  return Math.max(step, Math.round(minutes / step) * step);
}

/** ISO 日時 → 日本時間の時（0〜23） */
export function jstHour(iso: string): number {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: TIME_ZONE,
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(d);
  const h = parts.find((p) => p.type === "hour")?.value ?? "0";
  return Number(h) % 24;
}

/** 現在時刻を ISO 8601（+09:00 付き）で返す */
export function nowIso(date = new Date()): string {
  return toJstIso(date);
}

export function toJstIso(date: Date): string {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const mo = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  const h = String(jst.getUTCHours()).padStart(2, "0");
  const mi = String(jst.getUTCMinutes()).padStart(2, "0");
  const s = String(jst.getUTCSeconds()).padStart(2, "0");
  const ms = String(jst.getUTCMilliseconds()).padStart(3, "0");
  return `${y}-${mo}-${d}T${h}:${mi}:${s}.${ms}+09:00`;
}

/** api_usage の period 文字列（日本時間）。day: 2026-10-10、month: 2026-10 */
export function periodKey(kind: "day" | "month", date = new Date()): string {
  const iso = toJstIso(date);
  return kind === "day" ? iso.slice(0, 10) : iso.slice(0, 7);
}

/** 画面表示用：2026年10月10日 */
export function formatDateJa(isoOrYmd: string): string {
  const d = isoOrYmd.length === 10 ? new Date(`${isoOrYmd}T00:00:00+09:00`) : new Date(isoOrYmd);
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
}

export function formatDateTimeJa(iso: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** 曜日（0=日）を日本時間で返す */
export function jstWeekday(ymd: string): number {
  return new Date(`${ymd}T12:00:00+09:00`).getUTCDay();
}
