/**
 * 環境変数の読み取り（サーバー専用）。ブラウザからは import しないこと。
 */
export type DataBackend = "memory" | "supabase";

export function getDataBackend(): DataBackend {
  const v = process.env.DATA_BACKEND;
  if (v === "memory" || v === "supabase") return v;
  return process.env.NEXT_PUBLIC_SUPABASE_URL ? "supabase" : "memory";
}

export const serverConfig = {
  get backend(): DataBackend {
    return getDataBackend();
  },
  get memoryPersist(): boolean {
    return (process.env.MEMORY_PERSIST ?? "on") !== "off";
  },
  get supabaseUrl(): string | undefined {
    return process.env.NEXT_PUBLIC_SUPABASE_URL;
  },
  get supabaseAnonKey(): string | undefined {
    return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  },
  get supabaseServiceRoleKey(): string | undefined {
    return process.env.SUPABASE_SERVICE_ROLE_KEY;
  },
  get orsApiKey(): string | undefined {
    return process.env.ORS_API_KEY || undefined;
  },
  get nominatimEnabled(): boolean {
    return (process.env.NOMINATIM_ENABLED ?? "true") !== "false";
  },
  get nominatimUserAgent(): string {
    return process.env.NOMINATIM_USER_AGENT || "dokoiko-dev";
  },
  get notifyWebhookUrl(): string | undefined {
    return process.env.NOTIFY_WEBHOOK_URL || undefined;
  },
  get sentryDsn(): string | undefined {
    return process.env.SENTRY_DSN || undefined;
  },
  get siteUrl(): string {
    return process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  },
  /** memory モードのデータ置き場 */
  get dataDir(): string {
    return process.env.DOKOIKO_DATA_DIR || ".data";
  },
};
