// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LIMITS } from "@/lib/domain/constants";
import { StepContent, validateContent } from "./StepContent";
import { EMPTY_CONTENT, type ContentValue } from "./types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => cleanup());

function renderStep(value: ContentValue, onChange = vi.fn(), onNext = vi.fn()) {
  render(<StepContent value={value} onChange={onChange} onBack={() => {}} onNext={onNext} />);
  return { onChange, onNext };
}

describe("StepContent", () => {
  it("コメントの残り文字数を表示する（F-2-8）", () => {
    renderStep({ ...EMPTY_CONTENT, comment: "あ".repeat(140), category: "nature" });
    expect(screen.getByText(`残り ${LIMITS.commentMax - 140} 文字`)).toBeInTheDocument();
  });

  it("カテゴリ未選択のときは次へが無効", () => {
    renderStep({ ...EMPTY_CONTENT, comment: "" });
    expect(screen.getByRole("button", { name: "次へ" })).toBeDisabled();
  });

  it("カテゴリを選ぶと次へが有効になり、押すと onNext が呼ばれる", () => {
    const { onNext } = renderStep({ ...EMPTY_CONTENT, category: "gourmet" });
    const next = screen.getByRole("button", { name: "次へ" });
    expect(next).toBeEnabled();
    fireEvent.click(next);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("151 文字のコメントでは次へが無効になり、エラー文言を出す（受け入れ基準）", () => {
    renderStep({ ...EMPTY_CONTENT, comment: "あ".repeat(LIMITS.commentMax + 1), category: "nature" });
    expect(screen.getByRole("button", { name: "次へ" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      `コメントは${LIMITS.commentMax}文字以内で入力してください`,
    );
    expect(screen.getByText("残り -1 文字")).toBeInTheDocument();
  });

  it("150 文字ちょうどは通る", () => {
    renderStep({ ...EMPTY_CONTENT, comment: "a".repeat(LIMITS.commentMax), category: "history" });
    expect(screen.getByRole("button", { name: "次へ" })).toBeEnabled();
    expect(screen.getByText("残り 0 文字")).toBeInTheDocument();
  });

  it("カテゴリチップを押すと onChange に反映される", () => {
    const { onChange } = renderStep(EMPTY_CONTENT);
    fireEvent.click(screen.getByRole("radio", { name: "写真映え" }));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_CONTENT, category: "photogenic" });
  });

  it("滞在時間は任意で、選択中をもう一度押すと外せる", () => {
    const { onChange } = renderStep({ ...EMPTY_CONTENT, category: "nature", stayDuration: "lt60" });
    fireEvent.click(screen.getByRole("radio", { name: "〜1時間" }));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_CONTENT, category: "nature", stayDuration: null });
  });
});

describe("validateContent", () => {
  it("createPostSchema と同じルールで検証する", () => {
    expect(
      validateContent({ comment: "x".repeat(151), category: "nature", stayDuration: null }),
    ).toMatchObject({
      ok: false,
      errors: { comment: expect.stringContaining("150文字以内") },
    });
    expect(validateContent({ comment: "  ok  ", category: "other", stayDuration: "half_day" })).toEqual({
      ok: true,
      data: { comment: "ok", category: "other", stayDuration: "half_day" },
    });
    expect(validateContent({ comment: "", category: null, stayDuration: null })).toMatchObject({
      ok: false,
      errors: { category: "カテゴリを選んでください" },
    });
  });
});
