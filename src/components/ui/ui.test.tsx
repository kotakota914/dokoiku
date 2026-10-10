// @vitest-environment jsdom
/**
 * UI 部品の単体テスト。
 * @testing-library/dom が未導入でも動くよう、react-dom/client と act で直接マウントする。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { Textarea } from "./Input";
import { ChipGroup } from "./ChipGroup";
import { ToastProvider, useToast } from "./Toast";
import { SuspendedNotice } from "./SuspendedNotice";
import { PhotoImage } from "./PhotoImage";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; container: HTMLElement }[] = [];

function mount(ui: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  mounted.push({ root, container });
  return {
    container,
    rerender: (next: ReactNode) => act(() => root.render(next)),
  };
}

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const el = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);
  if (!el) throw new Error(`button "${text}" が見つかりません`);
  return el;
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

/** React の value 追跡を迂回してネイティブに値を入れ、input イベントを発火する */
function typeInto(el: HTMLTextAreaElement, text: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Button", () => {
  it("disabled のとき押せない", () => {
    const onClick = vi.fn();
    const { container } = mount(
      <Button disabled onClick={onClick}>
        保存
      </Button>,
    );
    const btn = buttonByText(container, "保存");
    expect(btn).toBeDisabled();
    click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("loading のとき disabled かつ aria-busy になりスピナーを出す", () => {
    const { container } = mount(<Button loading>保存</Button>);
    const btn = buttonByText(container, "保存");
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(btn.querySelector("svg.animate-spin")).not.toBeNull();
  });

  it("既定の type は button", () => {
    const { container } = mount(<Button>送信</Button>);
    expect(buttonByText(container, "送信")).toHaveAttribute("type", "button");
  });
});

describe("IconButton", () => {
  it("aria-label が付き、44px 以上のクラスを持ち、アイコンは aria-hidden", () => {
    const { container } = mount(<IconButton icon="x" aria-label="閉じる" />);
    const btn = container.querySelector("button");
    expect(btn).toHaveAttribute("aria-label", "閉じる");
    expect(btn?.className).toContain("min-h-11");
    expect(btn?.className).toContain("min-w-11");
    expect(btn?.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("Textarea", () => {
  it("残り文字数を表示し、入力で減る（非制御）", () => {
    const { container } = mount(<Textarea maxLength={150} aria-label="コメント" />);
    expect(container.textContent).toContain("残り 150 文字");
    typeInto(container.querySelector("textarea")!, "こんにちは");
    expect(container.textContent).toContain("残り 145 文字");
  });

  it("制御コンポーネントでも value の長さから残りを出す", () => {
    const { container } = mount(
      <Textarea maxLength={10} value="あいう" onChange={() => undefined} aria-label="c" />,
    );
    expect(container.textContent).toContain("残り 7 文字");
  });

  it("showCount=false なら表示しない", () => {
    const { container } = mount(<Textarea maxLength={10} showCount={false} aria-label="c" />);
    expect(container.textContent).not.toContain("残り");
  });
});

describe("ChipGroup", () => {
  it("単一選択：radiogroup で選択が切り替わる", () => {
    function Wrapper() {
      const [v, setV] = useState<"a" | "b" | null>(null);
      return (
        <ChipGroup
          aria-label="カテゴリ"
          options={[
            { value: "a", label: "自然" },
            { value: "b", label: "グルメ" },
          ]}
          value={v}
          onChange={setV}
        />
      );
    }
    const { container } = mount(<Wrapper />);
    expect(container.querySelector('[role="radiogroup"]')).toHaveAttribute("aria-label", "カテゴリ");
    const a = buttonByText(container, "自然");
    const b = buttonByText(container, "グルメ");
    expect(a).toHaveAttribute("role", "radio");
    expect(a).toHaveAttribute("aria-checked", "false");
    click(a);
    expect(a).toHaveAttribute("aria-checked", "true");
    click(b);
    expect(a).toHaveAttribute("aria-checked", "false");
    expect(b).toHaveAttribute("aria-checked", "true");
  });

  it("単一選択：allowDeselect のときだけ再押下で未選択に戻る", () => {
    const onChange = vi.fn();
    const { container, rerender } = mount(
      <ChipGroup options={[{ value: "a", label: "A" }]} value="a" onChange={onChange} />,
    );
    click(buttonByText(container, "A"));
    expect(onChange).not.toHaveBeenCalled();
    rerender(
      <ChipGroup options={[{ value: "a", label: "A" }]} value="a" onChange={onChange} allowDeselect />,
    );
    click(buttonByText(container, "A"));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("複数選択：aria-pressed でトグルし、options の順で返す", () => {
    function Wrapper() {
      const [v, setV] = useState<("x" | "y")[]>([]);
      return (
        <>
          <ChipGroup
            multiple
            options={[
              { value: "x", label: "X" },
              { value: "y", label: "Y" },
            ]}
            value={v}
            onChange={setV}
          />
          <output data-testid="out">{v.join(",")}</output>
        </>
      );
    }
    const { container } = mount(<Wrapper />);
    const x = buttonByText(container, "X");
    const y = buttonByText(container, "Y");
    const out = container.querySelector("output")!;
    click(y);
    click(x);
    expect(x).toHaveAttribute("aria-pressed", "true");
    expect(out.textContent).toBe("x,y");
    click(y);
    expect(y).toHaveAttribute("aria-pressed", "false");
    expect(out.textContent).toBe("x");
  });
});

describe("Toast", () => {
  function Trigger() {
    const toast = useToast();
    return (
      <>
        <button type="button" onClick={() => toast.success("保存しました")}>
          成功
        </button>
        <button type="button" onClick={() => toast.error("失敗しました")}>
          失敗
        </button>
      </>
    );
  }

  it("表示されて自動で消える（success 4 秒、error 6 秒）", () => {
    vi.useFakeTimers();
    try {
      const { container } = mount(
        <ToastProvider>
          <Trigger />
        </ToastProvider>,
      );
      click(buttonByText(container, "成功"));
      expect(container.querySelector('[role="status"]')).toHaveTextContent("保存しました");
      expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
      click(buttonByText(container, "失敗"));
      expect(container.querySelector('[role="alert"]')).toHaveTextContent("失敗しました");
      act(() => {
        vi.advanceTimersByTime(4000);
      });
      expect(container.textContent).not.toContain("保存しました");
      expect(container.textContent).toContain("失敗しました");
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(container.textContent).not.toContain("失敗しました");
    } finally {
      vi.useRealTimers();
    }
  });

  it("閉じるボタンで消える", () => {
    const { container } = mount(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    click(buttonByText(container, "成功"));
    expect(container.textContent).toContain("保存しました");
    click(container.querySelector('button[aria-label="閉じる"]')!);
    expect(container.textContent).not.toContain("保存しました");
  });
});

describe("SuspendedNotice", () => {
  it("FEATURE_LABELS の文言を出す", () => {
    const { container } = mount(<SuspendedNotice feature="route_planning" />);
    expect(container.querySelector('[role="status"]')).toHaveTextContent("現在、経路作成は利用できません");
  });
});

describe("PhotoImage", () => {
  it("読み込み失敗でカテゴリアイコンに切り替わる", () => {
    const { container } = mount(
      <PhotoImage src="https://example.com/x.webp" alt="写真" category="nature" className="size-12" />,
    );
    const img = container.querySelector("img")!;
    expect(img).toHaveAttribute("alt", "写真");
    act(() => {
      img.dispatchEvent(new Event("error"));
    });
    expect(container.querySelector("img")).toBeNull();
    const fallback = container.querySelector('[role="img"]')!;
    expect(fallback).toHaveAttribute("aria-label", "写真");
    expect(fallback.querySelector("svg")).not.toBeNull();
  });

  it("src が無ければ最初から代替表示", () => {
    const { container } = mount(<PhotoImage src={null} alt="写真" category="gourmet" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[role="img"] svg')).not.toBeNull();
  });
});
