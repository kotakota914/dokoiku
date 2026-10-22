/**
 * Gemini API（「AIと相談」。ADR-0023）。サーバーからのみ呼ぶ（API キーは GEMINI_API_KEY、モデルは GEMINI_MODEL）。
 * AI は会話を経路作成の条件（PlanPreferences）に変換するだけで、経路そのものは 11 章のロジックで計算する。
 * 無料枠の回数管理は usage.ts / services/plans.ts 側で行い、ここは HTTP 呼び出しだけを担当する。
 *
 * 公式仕様（https://ai.google.dev/api/generate-content）
 * - POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key=API_KEY
 *   body { systemInstruction: { parts: [{ text }] }, contents: [{ role: "user"|"model", parts: [{ text }] }],
 *          generationConfig: { responseMimeType: "application/json", responseSchema } }
 * - response.candidates[0].content.parts[0].text に JSON 文字列
 *
 * 送る情報は会話（messages）、対象スポットの { id, name, category }、共通条件（date / startTime / endTime / mode）、
 * 直前の conditions だけ。ユーザー名・メールアドレスは送らない。会話は保存せず、本文をログにも残さない（v0.3 Q3）。
 */
import { ApiError } from "@/lib/api/errors";
import { serverConfig } from "@/lib/config";
import {
  CATEGORY_LABELS,
  INTERESTS,
  PACES,
  PRIORITIES,
  TRAVEL_MODE_LABELS,
  type Category,
  type TravelMode,
} from "@/lib/domain/constants";
import type { PlanChatMessage, PlanPreferences } from "@/lib/domain/types";
import type { FetchLike } from "./notify";

export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export interface GeminiChatSpot {
  id: string;
  name: string;
  category: Category;
}

export interface GeminiChatInput {
  messages: readonly PlanChatMessage[];
  spots: readonly GeminiChatSpot[];
  params: { date: string; startTime: string; endTime: string; mode: TravelMode };
  /** これまでに読み取った条件（続きの会話で上書きしていく） */
  previous?: PlanPreferences | null;
}

export interface GeminiOptions {
  fetchImpl?: FetchLike;
  apiKey?: string;
  model?: string;
  /** タイムアウト（ms）。既定 20 秒 */
  timeoutMs?: number;
}

/** 返答の JSON の形（Gemini の responseSchema。OpenAPI のサブセット） */
export const GEMINI_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    reply: { type: "STRING" },
    unclear: { type: "BOOLEAN" },
    conditions: {
      type: "OBJECT",
      properties: {
        pace: { type: "STRING", enum: [...PACES] },
        interests: { type: "ARRAY", items: { type: "STRING", enum: [...INTERESTS] } },
        priority: { type: "STRING", enum: [...PRIORITIES] },
        timeWindows: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: { spotId: { type: "STRING" }, from: { type: "STRING" }, to: { type: "STRING" } },
            required: ["spotId", "from", "to"],
          },
        },
        orderHints: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              spotId: { type: "STRING" },
              position: { type: "STRING", enum: ["first", "last", "before", "after"] },
              relativeTo: { type: "STRING" },
            },
            required: ["spotId", "position"],
          },
        },
        exclude: { type: "ARRAY", items: { type: "STRING" } },
      },
      required: ["pace", "interests", "priority", "timeWindows", "orderHints", "exclude"],
    },
  },
  required: ["reply", "conditions", "unclear"],
} as const;

/** system 指示（日本語）。対象スポット・共通条件・直前の条件もここに入れる（会話本文には混ぜない） */
export function buildSystemInstruction(input: GeminiChatInput): string {
  const spots = input.spots.map((s) => ({ id: s.id, name: s.name, category: CATEGORY_LABELS[s.category] }));
  const lines = [
    "あなたは旅行の経路作成を手伝うアシスタントです。ユーザーとの会話から、経路作成の条件だけを読み取ります。経路そのものは別のプログラムが計算します。",
    "守ること：",
    "- 返答は指定された JSON の形だけで返す。会話文以外（説明、コード、装飾）を含めない。",
    "- 絵文字を使わない。reply は日本語で、2 文以内の会話文にする。",
    "- spotId には「対象スポット」に含まれる id だけを使う。それ以外の id を作らない。",
    "- 時刻は HH:MM（24 時間、日本時間）で書く。timeWindows は「そのスポットに着く時刻の範囲」。",
    `- pace は ${PACES.join(" / ")}、priority は ${PRIORITIES.join(" / ")}、interests は ${INTERESTS.join(" / ")} から選ぶ。`,
    "- orderHints の position は first（最初に行く）/ last（最後に行く）/ before（relativeTo より前）/ after（relativeTo より後）。",
    "- exclude は行かないスポットの id。",
    "- 会話から条件を読み取れない、または曖昧なときは unclear を true にし、reply で具体的に聞き返す。読み取れたときは unclear を false にする。",
    "- 直前の条件があれば引き継ぎ、会話で変わった部分だけを更新する。",
    "",
    `対象スポット（JSON）：${JSON.stringify(spots)}`,
    `共通の条件：日付 ${input.params.date}、開始 ${input.params.startTime}、終了 ${input.params.endTime}、移動手段 ${TRAVEL_MODE_LABELS[input.params.mode]}`,
    `直前の条件（JSON）：${input.previous ? JSON.stringify(input.previous) : "なし"}`,
  ];
  return lines.join("\n");
}

export function buildGeminiRequest(input: GeminiChatInput): Record<string, unknown> {
  return {
    systemInstruction: { parts: [{ text: buildSystemInstruction(input) }] },
    contents: input.messages.map((m) => ({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: m.content }],
    })),
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: GEMINI_RESPONSE_SCHEMA,
      temperature: 0.2,
    },
  };
}

/**
 * 会話を条件に変換する。戻り値は Gemini が返した JSON（検証前。services/plans.ts で zod 検証する）。
 * HTTP エラー・応答の不正は UPSTREAM_ERROR。
 */
export async function generatePlanConditions(
  input: GeminiChatInput,
  opts: GeminiOptions = {},
): Promise<unknown> {
  const apiKey = opts.apiKey ?? serverConfig.geminiApiKey;
  if (!apiKey) throw ApiError.upstream("AI サービスが設定されていません");
  const model = opts.model ?? serverConfig.geminiModel;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `${GEMINI_BASE_URL}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildGeminiRequest(input)),
      signal: controller.signal,
    });
  } catch (err) {
    // 会話本文・キーはログに出さない
    console.error("[gemini] request failed", err instanceof Error ? err.message : "error");
    throw ApiError.upstream("AI サービスに接続できませんでした");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    console.error(`[gemini] generateContent responded ${res.status}`);
    throw ApiError.upstream("AI サービスでエラーが発生しました");
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw ApiError.upstream("AI サービスの応答を読み取れませんでした");
  }
  const text = extractText(data);
  if (text === null) throw ApiError.upstream("AI サービスの応答が不正です");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw ApiError.upstream("AI サービスの応答が不正です");
  }
}

/** candidates[0].content.parts[].text を連結する */
export function extractText(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const candidates = (data as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const first = candidates[0] as { content?: { parts?: { text?: unknown }[] } };
  const parts = first?.content?.parts;
  if (!Array.isArray(parts)) return null;
  const text = parts.map((p) => (typeof p?.text === "string" ? p.text : "")).join("");
  return text.trim() ? text : null;
}
