// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { SpotSummary } from "@/lib/domain/types";
import { SpotPeekCard, newPostHref, spotDetailHref } from "./SpotPeekCard";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const spot: SpotSummary = {
  id: "spot-1",
  name: "兼六園",
  lat: 36.5619,
  lng: 136.6625,
  category: "history",
  postCount: 128,
  likeCount: 10,
  popularity: "very_popular",
  coverThumbUrl: null,
  prefecture: "石川県",
  city: "金沢市",
};

afterEach(() => cleanup());

describe("SpotPeekCard", () => {
  it("名前・投稿数・人気度・カテゴリを表示する", () => {
    render(<SpotPeekCard spot={spot} onAddToList={() => {}} />);
    expect(screen.getByRole("heading", { name: "兼六園" })).toBeInTheDocument();
    expect(screen.getByText("投稿 128件")).toBeInTheDocument();
    expect(screen.getByText("大人気")).toBeInTheDocument();
    expect(screen.getByText("歴史・文化")).toBeInTheDocument();
    expect(screen.getByText("石川県 金沢市")).toBeInTheDocument();
  });

  it("「詳細を見る」と「このスポットに投稿」のリンク先が正しい", () => {
    render(<SpotPeekCard spot={spot} onAddToList={() => {}} />);
    expect(screen.getByRole("link", { name: "詳細を見る" })).toHaveAttribute("href", "/spots/spot-1");
    expect(screen.getByRole("link", { name: "このスポットに投稿" })).toHaveAttribute(
      "href",
      "/posts/new?spotId=spot-1",
    );
    expect(spotDetailHref("a b")).toBe("/spots/a%20b");
    expect(newPostHref("a&b")).toBe("/posts/new?spotId=a%26b");
  });

  it("「行きたい場所リストに追加」でコールバックを呼ぶ", () => {
    const onAddToList = vi.fn();
    render(<SpotPeekCard spot={spot} onAddToList={onAddToList} />);
    fireEvent.click(screen.getByRole("button", { name: "行きたい場所リストに追加" }));
    expect(onAddToList).toHaveBeenCalledTimes(1);
  });

  it("投稿が停止中なら投稿ボタンを無効化し停止中の案内を出す", () => {
    render(<SpotPeekCard spot={spot} onAddToList={() => {}} postCreateSuspended />);
    expect(screen.queryByRole("link", { name: "このスポットに投稿" })).toBeNull();
    expect(screen.getByRole("button", { name: "このスポットに投稿" })).toBeDisabled();
    expect(screen.getByText(/現在、スポット投稿/)).toBeInTheDocument();
  });

  it("hideName のとき見出しを出さない（シートの title と重複させない）", () => {
    render(<SpotPeekCard spot={spot} onAddToList={() => {}} hideName />);
    expect(screen.queryByRole("heading", { name: "兼六園" })).toBeNull();
  });

  it("写真が無いときはカテゴリのアイコンで代替表示する", () => {
    render(<SpotPeekCard spot={spot} onAddToList={() => {}} />);
    expect(screen.getByRole("img", { name: "兼六園の代表写真" })).toBeInTheDocument();
  });
});
