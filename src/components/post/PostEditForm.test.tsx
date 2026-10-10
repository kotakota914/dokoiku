// @vitest-environment jsdom
/**
 * S-05 投稿編集（F-2-12）の単体テスト（fetch・アップロード・変換をモック）：
 * - 既存写真を 1 枚ずつ削除し、残した写真の確定済みパスを PATCH の images に渡す
 * - 写真を変えなければ PATCH の images を省略する
 * - 写真を追加すると新しい写真だけアップロードし、残した写真＋新しい写真を渡す
 * - 投稿（アップロード）停止中でも写真を追加しない保存はできる
 * - 一時アップロードの期限切れ（400 upload_missing）は再試行ボタンを出す
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { PostView } from "@/lib/domain/types";
import { ToastProvider } from "@/components/ui/Toast";
import { PostEditForm, canSavePhotos, keepableImages } from "./PostEditForm";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
}));

const systemStatus = { loading: false, suspended: false };
vi.mock("@/components/system/SystemStatusProvider", () => ({
  useSystemStatus: () => ({
    loading: systemStatus.loading,
    isSuspended: () => systemStatus.suspended,
  }),
}));

const uploadImages = vi.fn();
vi.mock("@/lib/images/upload", () => ({
  uploadImages: (...args: unknown[]) => uploadImages(...args),
}));

vi.mock("@/lib/images/convert", () => ({
  convertForUpload: async () => ({
    full: new Blob(["full"], { type: "image/webp" }),
    thumb: new Blob(["thumb"], { type: "image/webp" }),
    width: 1600,
    height: 1200,
    contentType: "image/webp",
  }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const post: PostView = {
  id: "33333333-3333-4333-8333-333333333333",
  userId: "u1",
  spotId: "22222222-2222-4222-8222-222222222222",
  spotName: "伏見稲荷大社",
  comment: "朱色の鳥居",
  category: "history",
  stayDuration: "lt60",
  status: "public",
  likeCount: 0,
  likedByMe: false,
  createdAt: "2026-10-01T10:00:00.000+09:00",
  updatedAt: "2026-10-01T10:00:00.000+09:00",
  author: { id: "u1", displayName: "開発ユーザーA", avatarUrl: null },
  images: [
    {
      id: "img-2",
      fullUrl: "/f/2.webp",
      thumbUrl: "/t/2.webp",
      width: 1600,
      height: 1200,
      sortOrder: 1,
      fullPath: "posts/p/2-full.webp",
      thumbPath: "posts/p/2-thumb.webp",
    },
    {
      id: "img-1",
      fullUrl: "/f/1.webp",
      thumbUrl: "/t/1.webp",
      width: 1600,
      height: 1200,
      sortOrder: 0,
      fullPath: "posts/p/1-full.webp",
      thumbPath: "posts/p/1-thumb.webp",
    },
  ],
} as PostView;

const KEPT_1 = {
  fullPath: "posts/p/1-full.webp",
  thumbPath: "posts/p/1-thumb.webp",
  width: 1600,
  height: 1200,
};
const KEPT_2 = {
  fullPath: "posts/p/2-full.webp",
  thumbPath: "posts/p/2-thumb.webp",
  width: 1600,
  height: 1200,
};

function wrap(ui: ReactNode) {
  return <ToastProvider>{ui}</ToastProvider>;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

let calls: { url: string; method?: string; body: unknown }[];

beforeEach(() => {
  calls = [];
  systemStatus.loading = false;
  systemStatus.suspended = false;
  uploadImages.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : null });
      return jsonResponse(post);
    }),
  );
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:preview" });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => undefined });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  push.mockReset();
});

describe("keepableImages / canSavePhotos", () => {
  it("sortOrder 順に並べ、パスの無い画像は残せない", () => {
    const kept = keepableImages(post.images);
    expect(kept.map((k) => k.id)).toEqual(["img-1", "img-2"]);
    expect(keepableImages([{ ...post.images[0], fullPath: undefined, thumbPath: undefined }])).toEqual([]);
  });

  it("合計 1〜4 枚で、新しい写真の変換が終わっていれば保存できる", () => {
    const kept = keepableImages(post.images);
    expect(canSavePhotos(kept, [])).toBe(true);
    expect(canSavePhotos([], [])).toBe(false);
    expect(canSavePhotos([], [{ id: "a", fileName: "a.jpg", status: "converting" }])).toBe(false);
    expect(canSavePhotos([...kept, ...kept, kept[0]], [])).toBe(false);
  });
});

describe("PostEditForm", () => {
  it("既存写真を 1 枚削除して保存すると、残した写真の確定済みパスを images に渡す", async () => {
    render(wrap(<PostEditForm post={post} />));
    expect(screen.getByRole("list", { name: "現在の写真" }).querySelectorAll("li")).toHaveLength(2);
    expect(screen.getByText("2/4枚")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "現在の写真 2枚目を削除" }));
    expect(screen.getByText("1/4枚")).toBeInTheDocument();
    expect(screen.getByText("写真を変更中")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].url).toBe(`/api/v1/posts/${post.id}`);
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].body).toMatchObject({ comment: "朱色の鳥居", category: "history", images: [KEPT_1] });
    expect(uploadImages).not.toHaveBeenCalled();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/me"));
  });

  it("写真を変えなければ images を送らない", async () => {
    render(wrap(<PostEditForm post={post} />));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).not.toHaveProperty("images");
  });

  it("すべて削除すると 1 枚未満になり保存できない。元に戻すと保存できる", () => {
    render(wrap(<PostEditForm post={post} />));
    fireEvent.click(screen.getByRole("button", { name: "現在の写真 2枚目を削除" }));
    fireEvent.click(screen.getByRole("button", { name: "現在の写真 1枚目を削除" }));
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "写真の変更を元に戻す" }));
    expect(screen.getByRole("list", { name: "現在の写真" }).querySelectorAll("li")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
  });

  it("写真を追加すると新しい写真だけアップロードし、残した写真の後ろに付けて送る", async () => {
    const uploaded = {
      fullPath: "tmp/u/n-full.webp",
      thumbPath: "tmp/u/n-thumb.webp",
      width: 1600,
      height: 1200,
    };
    uploadImages.mockResolvedValue([uploaded]);
    const { container } = render(wrap(<PostEditForm post={post} />));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(["x"], "new.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [file] } });
    await screen.findByAltText("1枚目：new.jpg");
    expect(screen.getByText("3/4枚")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(uploadImages).toHaveBeenCalledTimes(1);
    expect(calls[0].body).toMatchObject({ images: [KEPT_1, KEPT_2, uploaded] });
  });

  it("投稿が停止中でも写真を追加しない編集は保存でき、写真の追加だけ止まる（Q4）", async () => {
    systemStatus.suspended = true;
    const { container } = render(wrap(<PostEditForm post={post} />));
    expect(screen.getByText(/写真の追加はできません/)).toBeInTheDocument();
    expect(container.querySelector<HTMLInputElement>('input[type="file"]')).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "現在の写真 2枚目を削除" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toMatchObject({ images: [KEPT_1] });
  });

  it("一時アップロードの期限切れ（400 upload_missing）は再試行ボタンを出す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "画像が見つかりません",
              details: [{ field: "images", reason: "upload_missing" }],
            },
          },
          400,
        ),
      ),
    );
    render(wrap(<PostEditForm post={post} />));
    fireEvent.click(screen.getByRole("button", { name: "現在の写真 2枚目を削除" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("button", { name: "再試行" })).toBeInTheDocument();
    expect(screen.getByText(/もう一度アップロード/)).toBeInTheDocument();
  });
});
