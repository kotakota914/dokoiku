import { describe, expect, it, vi } from "vitest";
import {
  buildGeminiRequest,
  extractText,
  GEMINI_BASE_URL,
  generatePlanConditions,
  type GeminiChatInput,
} from "./gemini";
import type { FetchLike } from "./notify";

const INPUT: GeminiChatInput = {
  messages: [
    { role: "user", content: "夕日は金沢港で見たい" },
    { role: "assistant", content: "何時ごろがよいですか" },
    { role: "user", content: "16時半ごろ" },
  ],
  spots: [{ id: "b0000000-0000-4000-8000-000000000004", name: "金沢港", category: "nature" }],
  params: { date: "2026-11-03", startTime: "09:00", endTime: "18:00", mode: "transit" },
  previous: null,
};

function geminiResponse(obj: unknown): Response {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

describe("buildGeminiRequest", () => {
  it("JSON 形式（responseSchema）で答えさせ、会話・スポット・共通条件だけを送る", () => {
    const body = buildGeminiRequest(INPUT) as {
      systemInstruction: { parts: { text: string }[] };
      contents: { role: string; parts: { text: string }[] }[];
      generationConfig: { responseMimeType: string; responseSchema: { required: string[] } };
    };
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseSchema.required).toEqual(["reply", "conditions", "unclear"]);
    expect(body.contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
    const sys = body.systemInstruction.parts[0].text;
    expect(sys).toContain("絵文字を使わない");
    expect(sys).toContain("HH:MM");
    expect(sys).toContain("b0000000-0000-4000-8000-000000000004");
    expect(sys).toContain("金沢港");
    expect(sys).toContain("公共交通＋徒歩");
    // ユーザー名・メールなどは入力に無いので送られない
    expect(JSON.stringify(body)).not.toMatch(/@|displayName|email/);
  });
});

describe("generatePlanConditions", () => {
  it("キーはクエリ、モデルは URL に入れ、返答の JSON を返す", async () => {
    const answer = { reply: "了解です", conditions: { pace: "normal" }, unclear: false };
    const fetchImpl = vi.fn<FetchLike>(async () => geminiResponse(answer));
    const r = await generatePlanConditions(INPUT, { fetchImpl, apiKey: "k1", model: "gemini-2.5-flash" });
    expect(r).toEqual(answer);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      `${GEMINI_BASE_URL}/models/gemini-2.5-flash:generateContent?key=k1`,
    );
  });

  it("HTTP エラー・JSON でない返答・キー未設定は UPSTREAM_ERROR", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const err = vi.fn<FetchLike>(async () => new Response("x", { status: 500 }));
    await expect(generatePlanConditions(INPUT, { fetchImpl: err, apiKey: "k" })).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
    });
    const text = vi.fn<FetchLike>(
      async () =>
        new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "こんにちは" }] } }] }), {
          status: 200,
        }),
    );
    await expect(generatePlanConditions(INPUT, { fetchImpl: text, apiKey: "k" })).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
    });
    await expect(
      generatePlanConditions(INPUT, { fetchImpl: vi.fn<FetchLike>(), apiKey: "" }),
    ).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
    });
    expect(extractText({ candidates: [] })).toBeNull();
  });
});
