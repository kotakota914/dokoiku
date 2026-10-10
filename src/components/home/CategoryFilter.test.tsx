// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CATEGORIES, CATEGORY_LABELS } from "@/lib/domain/constants";
import { CATEGORY_OPTIONS, CategoryFilter } from "./CategoryFilter";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => cleanup());

describe("CategoryFilter", () => {
  it("5 つのカテゴリを日本語ラベルのチップで表示する", () => {
    render(<CategoryFilter value={[]} onChange={() => {}} />);
    expect(CATEGORY_OPTIONS.map((o) => o.value)).toEqual([...CATEGORIES]);
    for (const c of CATEGORIES) {
      expect(screen.getByRole("button", { name: CATEGORY_LABELS[c] })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    }
  });

  it("チップを押すと選択中の配列を onChange に渡す（複数選択）", () => {
    const onChange = vi.fn();
    render(<CategoryFilter value={["nature"]} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "自然" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "グルメ" }));
    expect(onChange).toHaveBeenCalledWith(["nature", "gourmet"]);
  });

  it("選択中のチップを押すと外す", () => {
    const onChange = vi.fn();
    render(<CategoryFilter value={["nature", "history"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "自然" }));
    expect(onChange).toHaveBeenCalledWith(["history"]);
  });

  it("disabled のとき押せない", () => {
    const onChange = vi.fn();
    render(<CategoryFilter value={[]} onChange={onChange} disabled />);
    const btn = screen.getByRole("button", { name: "写真映え" });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onChange).not.toHaveBeenCalled();
  });
});
