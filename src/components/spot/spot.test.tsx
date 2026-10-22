// @vitest-environment jsdom
/**
 * S-02 部品の単体テスト：HourHistogram、LikeButton（fetch をモック）、PostCard（本人の編集リンク）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PostView } from "@/lib/domain/types";
import { ToastProvider } from "@/components/ui/Toast";
import { HourHistogram, peakHour } from "./HourHistogram";
import { LikeButton } from "./LikeButton";
import { PostCard } from "./PostCard";
import { SpotActions } from "./SpotActions";
import { SystemStatusProvider } from "@/components/system/SystemStatusProvider";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; container: HTMLElement }[] = [];

function mount(ui: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<ToastProvider>{ui}</ToastProvider>));
  mounted.push({ root, container });
  return container;
}

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  vi.restoreAllMocks();
  push.mockReset();
});

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("HourHistogram", () => {
  it("24 本の棒を描き、最大値の棒が 100% になる", () => {
    const histogram = Array.from({ length: 24 }, (_, h) => (h === 14 ? 8 : h === 10 ? 4 : 0));
    const container = mount(<HourHistogram histogram={histogram} />);
    const bars = container.querySelectorAll<HTMLElement>('[data-testid="hour-bar"]');
    expect(bars).toHaveLength(24);
    expect(bars[14].style.height).toBe("100%");
    expect(bars[10].style.height).toBe("50%");
    expect(bars[0].style.height).toBe("0%");
    expect(container.textContent).toContain("最も多い時間帯：14時台");
  });

  it("投稿が無いときは情報なしを出す", () => {
    const container = mount(<HourHistogram histogram={[]} />);
    expect(container.querySelectorAll('[data-testid="hour-bar"]')).toHaveLength(24);
    expect(container.textContent).toContain("情報なし");
    expect(peakHour([])).toBeNull();
  });
});

describe("LikeButton", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("押すと PUT /api/v1/posts/{id}/like を呼び、もう一度押すと DELETE を呼ぶ", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ likeCount: 4 }))
      .mockResolvedValueOnce(jsonResponse({ likeCount: 3 }));
    const container = mount(
      <LikeButton postId="post-1" likeCount={3} likedByMe={false} currentUserId="user-1" />,
    );
    const btn = container.querySelector("button")!;
    expect(btn).toHaveAttribute("aria-pressed", "false");

    click(btn);
    // 楽観的更新：即座に 4 件・押下状態になる
    expect(btn).toHaveAttribute("aria-pressed", "true");
    expect(btn.textContent).toContain("4");
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/posts/post-1/like");
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("PUT");

    click(btn);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe("DELETE");
    expect(btn).toHaveAttribute("aria-pressed", "false");
    expect(btn.textContent).toContain("3");
  });

  it("API が失敗したら元に戻す", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: "INTERNAL_ERROR", message: "失敗" } }, 500),
    );
    const container = mount(
      <LikeButton postId="post-1" likeCount={3} likedByMe={false} currentUserId="user-1" />,
    );
    const btn = container.querySelector("button")!;
    click(btn);
    await flush();
    expect(btn).toHaveAttribute("aria-pressed", "false");
    expect(btn.textContent).toContain("3");
  });

  it("未ログインなら API を呼ばずにログイン画面へ", async () => {
    const container = mount(
      <LikeButton postId="post-1" likeCount={3} likedByMe={false} currentUserId={null} />,
    );
    click(container.querySelector("button")!);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith(
      `/login?next=${encodeURIComponent(`${window.location.pathname}${window.location.search}${window.location.hash}`)}`,
    );
  });
});

const basePost: PostView = {
  id: "post-1",
  userId: "user-1",
  spotId: "spot-1",
  comment: "紅葉がきれいでした",
  category: "nature",
  stayDuration: "lt60",
  likeCount: 2,
  status: "public",
  createdAt: "2026-10-01T10:00:00.000+09:00",
  updatedAt: "2026-10-01T10:00:00.000+09:00",
  author: { id: "user-1", displayName: "たろう", avatarUrl: null },
  spotName: "兼六園",
  images: [{ id: "img-1", fullUrl: "/f.webp", thumbUrl: "/t.webp", width: 400, height: 300, sortOrder: 0 }],
  likedByMe: false,
};

describe("PostCard", () => {
  it("本人なら編集リンクを出し、通報は出さない", () => {
    const container = mount(<PostCard post={basePost} currentUserId="user-1" />);
    const edit = container.querySelector('a[href="/posts/post-1/edit"]');
    expect(edit).not.toBeNull();
    expect(edit?.textContent).toContain("編集");
    expect(container.textContent).not.toContain("通報");
  });

  it("他人なら通報ボタンを出し、編集リンクは出さない", () => {
    const container = mount(<PostCard post={basePost} currentUserId="user-2" />);
    expect(container.querySelector('a[href="/posts/post-1/edit"]')).toBeNull();
    const report = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("通報"),
    );
    expect(report).toBeDefined();
    click(report!);
    // ダイアログは document.body へポータルで描画される
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("この投稿を通報");
  });

  it("非表示の投稿にはバッジを出し、showSpotName でスポットへのリンクを出す", () => {
    const container = mount(
      <PostCard post={{ ...basePost, status: "hidden" }} currentUserId="user-1" showSpotName />,
    );
    expect(container.textContent).toContain("非表示");
    expect(container.querySelector('a[href="/spots/spot-1"]')?.textContent).toContain("兼六園");
  });
});

describe("SpotActions（v0.3 F-3-5）", () => {
  it("外部の地図アプリへのリンクを置かない。リスト追加と投稿は残る", () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ suspended: [], capabilities: {} }), { status: 200 }),
    );
    const container = mount(
      <SystemStatusProvider
        initialStatus={{
          suspended: [],
          capabilities: {
            externalSearch: false,
            routing: false,
            transit: false,
            ai: false,
            googleLogin: false,
            backend: "memory",
          },
        }}
      >
        <SpotActions spotId="b0000000-0000-4000-8000-000000000001" currentUserId={null} />
      </SystemStatusProvider>,
    );
    expect(container.textContent).not.toContain("Googleマップ");
    expect(container.querySelector('a[target="_blank"]')).toBeNull();
    expect(container.querySelector('a[href*="google"]')).toBeNull();
    expect(container.querySelector(".lucide-external-link")).toBeNull();
    expect(container.textContent).toContain("行きたい場所リストに追加");
    expect(container.textContent).toContain("このスポットに投稿");
  });
});
