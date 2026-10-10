/**
 * F-8-3 / Q14：停止・再開などの通知。
 * NOTIFY_WEBHOOK_URL があれば Discord Webhook 形式（{ content }）で POST し、無ければサーバーログだけに出す。
 * 送信失敗は握りつぶしてログに残す（通知の失敗で本処理を止めない）。
 *
 * Discord Webhook の仕様：POST <webhook url>、JSON body の `content`（最大 2000 文字）
 * https://discord.com/developers/docs/resources/webhook#execute-webhook
 */
import { serverConfig } from "@/lib/config";

export type NotifyLevel = "info" | "warn" | "error";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const PREFIX: Record<NotifyLevel, string> = { info: "[dokoiko]", warn: "[dokoiko][warn]", error: "[dokoiko][error]" };

export async function notify(message: string, level: NotifyLevel = "info", fetchImpl: FetchLike = fetch): Promise<void> {
  const text = `${PREFIX[level]} ${message}`.slice(0, 2000);
  const logger = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  logger(text);
  const url = serverConfig.notifyWebhookUrl;
  if (!url) return;
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text }),
    });
    if (!res.ok) console.error(`[notify] webhook responded ${res.status}`);
  } catch (err) {
    console.error("[notify] webhook failed", err instanceof Error ? err.message : err);
  }
}
