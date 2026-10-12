// @vitest-environment jsdom
/**
 * ShareButton の単体テスト：
 * - navigator.share がある端末では共有シート（navigator.share）を呼ぶ。画像があれば canShare で判定して files を渡す
 * - 無い環境（PC）ではダイアログ（リンクをコピー／Xで投稿／LINEで送る）。URL は origin を付けた絶対 URL
 * - shareLinks：X / LINE の URL、文言
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { ToastProvider } from "@/components/ui/Toast";
import { ShareButton, ShareOptions } from "./ShareButton";
import {
  absoluteShareUrl,
  canNativeShare,
  lineShareUrl,
  listShareText,
  planShareText,
  spotShareText,
  xShareUrl,
} from "./shareLinks";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function wrap(ui: ReactNode) {
  return <ToastProvider>{ui}</ToastProvider>;
}

function defineNavigator(name: "share" | "canShare" | "clipboard", value: unknown) {
  Object.defineProperty(navigator, name, { value, configurable: true, writable: true });
}

function removeNavigator(name: "share" | "canShare" | "clipboard") {
  delete (navigator as unknown as Record<string, unknown>)[name];
}

const props = { title: "兼六園", text: "兼六園（投稿 3 件）| 旅行どこいこう", url: "/spots/abc" };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  removeNavigator("share");
  removeNavigator("canShare");
  removeNavigator("clipboard");
});

describe("shareLinks", () => {
  it("X / LINE の URL と絶対 URL を組み立てる", () => {
    expect(absoluteShareUrl("/spots/abc", "http://localhost:3000")).toBe("http://localhost:3000/spots/abc");
    expect(absoluteShareUrl("https://example.com/x", "http://localhost:3000")).toBe("https://example.com/x");
    const x = new URL(xShareUrl("兼六園 | 旅行どこいこう", "https://example.com/spots/abc"));
    expect(x.origin + x.pathname).toBe("https://twitter.com/intent/tweet");
    expect(x.searchParams.get("text")).toBe("兼六園 | 旅行どこいこう");
    expect(x.searchParams.get("url")).toBe("https://example.com/spots/abc");
    expect(lineShareUrl("https://example.com/spots/abc?x=1")).toBe(
      "https://social-plugins.line.me/lineit/share?url=https%3A%2F%2Fexample.com%2Fspots%2Fabc%3Fx%3D1",
    );
  });

  it("共有文言に絵文字を使わず、件数とサービス名を含める", () => {
    expect(spotShareText("兼六園", 12)).toBe("兼六園（投稿 12 件）| 旅行どこいこう");
    expect(planShareText("2026年10月12日", 3)).toBe("2026年10月12日のプラン（3か所）| 旅行どこいこう");
    expect(listShareText("金沢旅行", 5)).toBe("金沢旅行（5件）| 旅行どこいこう");
  });

  it("navigator.share の有無で判定する", () => {
    expect(canNativeShare(undefined)).toBe(false);
    expect(canNativeShare({ share: undefined } as unknown as Navigator)).toBe(false);
    expect(canNativeShare({ share: async () => undefined } as unknown as Navigator)).toBe(true);
  });
});

describe("ShareButton（navigator.share あり）", () => {
  it("共有シートを開き、title・text・絶対 URL を渡す", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    defineNavigator("share", share);
    render(wrap(<ShareButton {...props} variant="icon" label="このスポットを共有" />));
    fireEvent.click(screen.getByRole("button", { name: "このスポットを共有" }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(share).toHaveBeenCalledWith({
      title: "兼六園",
      text: "兼六園（投稿 3 件）| 旅行どこいこう",
      url: `${window.location.origin}/spots/abc`,
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("画像があり canShare が true なら files も渡す", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    defineNavigator("share", share);
    defineNavigator("canShare", vi.fn().mockReturnValue(true));
    const blob = new Blob(["png"], { type: "image/png" });
    render(wrap(<ShareButton {...props} label="しおり画像を共有" imageBlob={async () => blob} imageFileName="plan.png" />));
    fireEvent.click(screen.getByRole("button", { name: "しおり画像を共有" }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const data = share.mock.calls[0][0] as ShareData;
    expect(data.files).toHaveLength(1);
    expect(data.files?.[0].name).toBe("plan.png");
    expect(data.files?.[0].type).toBe("image/png");
  });

  it("canShare が false ならリンクだけを共有して案内する", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    defineNavigator("share", share);
    defineNavigator("canShare", vi.fn().mockReturnValue(false));
    render(wrap(<ShareButton {...props} imageBlob={async () => new Blob(["png"], { type: "image/png" })} />));
    fireEvent.click(screen.getByRole("button", { name: "共有" }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect((share.mock.calls[0][0] as ShareData).files).toBeUndefined();
    expect(await screen.findByText("この端末では画像を一緒に共有できないため、リンクだけを共有します")).toBeInTheDocument();
  });

  it("キャンセル（AbortError）は何も表示しない。それ以外の失敗はトースト", async () => {
    const abort = new Error("cancel");
    abort.name = "AbortError";
    const share = vi.fn().mockRejectedValueOnce(abort).mockRejectedValueOnce(new Error("boom"));
    defineNavigator("share", share);
    render(wrap(<ShareButton {...props} />));
    const button = screen.getByRole("button", { name: "共有" });
    fireEvent.click(button);
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(button).not.toHaveAttribute("aria-busy"));
    expect(screen.queryByText("共有できませんでした")).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(await screen.findByText("共有できませんでした")).toBeInTheDocument();
  });
});

describe("ShareButton（navigator.share なし：PC）", () => {
  it("ダイアログを出し、X のリンクを新しいタブで開く", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(wrap(<ShareButton {...props} />));
    fireEvent.click(screen.getByRole("button", { name: "共有" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(`${window.location.origin}/spots/abc`);
    fireEvent.click(screen.getByRole("button", { name: "Xで投稿" }));
    expect(open).toHaveBeenCalledTimes(1);
    const href = new URL(open.mock.calls[0][0] as string);
    expect(href.origin + href.pathname).toBe("https://twitter.com/intent/tweet");
    expect(href.searchParams.get("url")).toBe(`${window.location.origin}/spots/abc`);
    expect(href.searchParams.get("text")).toBe(props.text);
    expect(open.mock.calls[0][1]).toBe("_blank");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("LINE のリンクを新しいタブで開く", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(wrap(<ShareButton {...props} />));
    fireEvent.click(screen.getByRole("button", { name: "共有" }));
    fireEvent.click(await screen.findByRole("button", { name: "LINEで送る" }));
    expect(open.mock.calls[0][0]).toBe(lineShareUrl(`${window.location.origin}/spots/abc`));
  });

  it("リンクをコピーするとクリップボードに書き、成功トーストを出す", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    defineNavigator("clipboard", { writeText });
    render(wrap(<ShareButton {...props} />));
    fireEvent.click(screen.getByRole("button", { name: "共有" }));
    fireEvent.click(await screen.findByRole("button", { name: "リンクをコピー" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/spots/abc`));
    expect(await screen.findByText("リンクをコピーしました")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("コピーに失敗したらエラートースト", async () => {
    defineNavigator("clipboard", { writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    render(wrap(<ShareOptions title="t" text="x" url="https://example.com/a" />));
    fireEvent.click(screen.getByRole("button", { name: "リンクをコピー" }));
    expect(await screen.findByText(/コピーできませんでした/)).toBeInTheDocument();
  });

  it("画像があるときはダウンロードする（<a download>）", async () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:mock");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true, writable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectURL, configurable: true, writable: true });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(
      wrap(
        <ShareButton
          {...props}
          label="しおり画像を共有"
          imageBlob={async () => new Blob(["png"], { type: "image/png" })}
          imageFileName="plan.png"
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "しおり画像を共有" }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    const anchor = click.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toBe("plan.png");
    expect(anchor.href).toBe("blob:mock");
    expect(await screen.findByText(/画像を保存しました/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("画像の取得に失敗したらトーストを出して何も開かない", async () => {
    render(wrap(<ShareButton {...props} imageBlob={async () => null} />));
    fireEvent.click(screen.getByRole("button", { name: "共有" }));
    expect(await screen.findByText("画像を取得できませんでした")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
