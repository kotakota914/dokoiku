// @vitest-environment jsdom
import { act } from "react";
import { beforeAll, describe, expect, it } from "vitest";
import {
  clusterAriaLabel,
  createClusterElement,
  createPinElement,
  createStopElement,
  disposeMarkerElement,
  PIN_BORDER_PX,
  PIN_BORDER_SELECTED_PX,
  type PinSpec,
  updateClusterElement,
  updatePinElement,
  updateStopElement,
} from "./markers";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const basePin: PinSpec = {
  spotId: "a",
  name: "伏見稲荷大社",
  postCount: 3,
  popularity: "normal",
  category: "history",
  coverThumbUrl: "/t/a.webp",
  selected: false,
};

/** React ルート（アイコン）の描画を act の中で行い、完了を待つ */
async function flush() {
  await act(async () => {});
}

/** マーカー生成・更新（内部で React ルートを描画する）を act で包む */
function within<T>(fn: () => T): T {
  let result!: T;
  act(() => {
    result = fn();
  });
  return result;
}

describe("createPinElement / updatePinElement", () => {
  it("button で aria-label に名前と投稿数、枠は人気度の色", async () => {
    const el = within(() => createPinElement(basePin));
    await flush();
    expect(el.tagName).toBe("BUTTON");
    expect(el.type).toBe("button");
    expect(el.getAttribute("aria-label")).toBe("伏見稲荷大社（投稿3件）");
    expect(el.dataset.popularity).toBe("normal");
    const frame = el.querySelector<HTMLElement>(".dk-pin__frame")!;
    expect(frame.style.borderColor).toBe("var(--color-popularity-normal)");
    expect(frame.style.borderWidth).toBe(`${PIN_BORDER_PX}px`);
    expect(el.querySelector("[data-flame]")).toBeNull();
    const img = el.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("/t/a.webp");
    expect(el.style.width).toBe("56px");
    disposeMarkerElement(el);
  });

  it("大人気は枠が very の色で flame アイコンが付き、人気は popular の色", async () => {
    const el = within(() => createPinElement({ ...basePin, postCount: 25, popularity: "very_popular" }));
    await flush();
    expect(el.getAttribute("aria-label")).toBe("伏見稲荷大社（投稿25件）、大人気");
    const frame = el.querySelector<HTMLElement>(".dk-pin__frame")!;
    expect(frame.style.borderColor).toBe("var(--color-popularity-very)");
    const flame = el.querySelector("[data-flame]")!;
    expect(flame).not.toBeNull();
    expect(flame.querySelector("svg")).not.toBeNull();

    const popular = within(() => createPinElement({ ...basePin, postCount: 7, popularity: "popular" }));
    await flush();
    expect(popular.querySelector<HTMLElement>(".dk-pin__frame")!.style.borderColor).toBe(
      "var(--color-popularity-popular)",
    );
    expect(popular.querySelector("[data-flame]")).toBeNull();
    disposeMarkerElement(el);
    disposeMarkerElement(popular);
  });

  it("選択中は枠が太くなり、更新で元に戻る。flame も更新で付け外しされる", async () => {
    const el = within(() => createPinElement({ ...basePin, selected: true }));
    await flush();
    const frame = el.querySelector<HTMLElement>(".dk-pin__frame")!;
    expect(frame.style.borderWidth).toBe(`${PIN_BORDER_SELECTED_PX}px`);
    expect(el.dataset.selected).toBe("true");
    expect(el.getAttribute("aria-pressed")).toBe("true");

    within(() =>
      updatePinElement(el, { ...basePin, selected: false, postCount: 30, popularity: "very_popular" }),
    );
    await flush();
    expect(frame.style.borderWidth).toBe(`${PIN_BORDER_PX}px`);
    expect(el.dataset.selected).toBeUndefined();
    expect(el.querySelector("[data-flame]")).not.toBeNull();
    expect(el.getAttribute("aria-label")).toBe("伏見稲荷大社（投稿30件）、大人気");

    within(() => updatePinElement(el, basePin));
    expect(el.querySelector("[data-flame]")).toBeNull();
    expect(frame.style.borderColor).toBe("var(--color-popularity-normal)");
    disposeMarkerElement(el);
  });

  it("写真が無い・読み込み失敗ならカテゴリのアイコンに差し替える", async () => {
    const noPhoto = within(() => createPinElement({ ...basePin, coverThumbUrl: null, category: "nature" }));
    await flush();
    const fallback = noPhoto.querySelector<HTMLElement>(".dk-marker__fallback")!;
    expect(fallback.classList.contains("hidden")).toBe(false);
    expect(fallback.dataset.category).toBe("nature");
    expect(fallback.querySelector("svg")).not.toBeNull();
    expect(noPhoto.querySelector("img")!.classList.contains("hidden")).toBe(true);

    const broken = within(() => createPinElement({ ...basePin, category: "gourmet" }));
    await flush();
    const img = broken.querySelector("img")!;
    expect(broken.querySelector<HTMLElement>(".dk-marker__fallback")!.classList.contains("hidden")).toBe(
      true,
    );
    await act(async () => {
      img.dispatchEvent(new Event("error"));
    });
    expect(img.classList.contains("hidden")).toBe(true);
    const fb = broken.querySelector<HTMLElement>(".dk-marker__fallback")!;
    expect(fb.classList.contains("hidden")).toBe(false);
    expect(fb.querySelector("svg")).not.toBeNull();
    disposeMarkerElement(noPhoto);
    disposeMarkerElement(broken);
  });
});

describe("createClusterElement / updateClusterElement", () => {
  it("投稿数に応じて枚数・サイズが変わり、右下のバッジに件数", async () => {
    const small = within(() =>
      createClusterElement({
        key: "c:1",
        postCount: 4,
        spotCount: 2,
        coverThumbUrl: "/t/x.webp",
        name: "A",
        category: "other",
      }),
    );
    await flush();
    expect(small.tagName).toBe("BUTTON");
    expect(small.dataset.layers).toBe("1");
    expect(small.dataset.size).toBe("48");
    expect(small.querySelectorAll(".dk-cluster__card")).toHaveLength(1);
    expect(small.querySelector<HTMLElement>(".dk-cluster__badge")!.textContent).toBe("4");
    expect(small.getAttribute("aria-label")).toBe("A ほか1か所（投稿4件）。タップで拡大");
    expect(small.querySelector("img")!.getAttribute("src")).toBe("/t/x.webp");

    const mid = within(() =>
      createClusterElement({
        key: "c:2",
        postCount: 5,
        spotCount: 3,
        coverThumbUrl: null,
        name: "B",
        category: "nature",
      }),
    );
    await flush();
    expect(mid.dataset.layers).toBe("2");
    expect(mid.dataset.size).toBe("64");
    expect(mid.querySelectorAll(".dk-cluster__card")).toHaveLength(2);
    expect(mid.querySelector(".dk-cluster__front .dk-marker__fallback svg")).not.toBeNull();

    const big = within(() =>
      createClusterElement({
        key: "c:3",
        postCount: 1234,
        spotCount: 10,
        coverThumbUrl: "/t/y.webp",
        name: "C",
        category: "gourmet",
      }),
    );
    expect(big.dataset.layers).toBe("3");
    expect(big.dataset.size).toBe("80");
    expect(big.querySelectorAll(".dk-cluster__card")).toHaveLength(3);
    expect(big.querySelector<HTMLElement>(".dk-cluster__badge")!.textContent).toBe("1,234");
    expect(big.style.width).toBe("80px");
    for (const el of [small, mid, big]) disposeMarkerElement(el);
  });

  it("単独点は 1 枚で「ほか」を付けない。更新で段階が変われば作り直す", async () => {
    const el = within(() =>
      createClusterElement({
        key: "s:a",
        postCount: 2,
        spotCount: 1,
        coverThumbUrl: "/t/a.webp",
        name: "A",
        category: "history",
      }),
    );
    await flush();
    expect(el.getAttribute("aria-label")).toBe("A（投稿2件）");
    expect(clusterAriaLabel({ name: "A", postCount: 2, spotCount: 1 })).toBe("A（投稿2件）");

    within(() =>
      updateClusterElement(el, {
        key: "s:a",
        postCount: 3,
        spotCount: 1,
        coverThumbUrl: "/t/b.webp",
        name: "A",
        category: "history",
      }),
    );
    expect(el.dataset.layers).toBe("1");
    expect(el.querySelector<HTMLElement>(".dk-cluster__badge")!.textContent).toBe("3");
    expect(el.querySelector("img")!.getAttribute("src")).toBe("/t/b.webp");

    within(() =>
      updateClusterElement(el, {
        key: "s:a",
        postCount: 20,
        spotCount: 1,
        coverThumbUrl: "/t/b.webp",
        name: "A",
        category: "history",
      }),
    );
    await flush();
    expect(el.dataset.layers).toBe("3");
    expect(el.querySelectorAll(".dk-cluster__card")).toHaveLength(3);
    expect(el.getAttribute("aria-label")).toBe("A（投稿20件）");
    disposeMarkerElement(el);
  });
});

describe("createStopElement", () => {
  it("番号と種類を持ち、更新で種類の見た目が変わる", () => {
    const el = within(() => createStopElement({ label: "1", kind: "spot", name: "清水寺" }));
    expect(el.textContent).toBe("1");
    expect(el.getAttribute("aria-label")).toBe("1番目 清水寺");
    expect(el.classList.contains("bg-primary")).toBe(true);
    within(() => updateStopElement(el, { label: "着", kind: "destination", name: "京都駅" }));
    expect(el.textContent).toBe("着");
    expect(el.getAttribute("aria-label")).toBe("到着地 京都駅");
    expect(el.classList.contains("bg-primary")).toBe(false);
    expect(el.classList.contains("bg-text")).toBe(true);
    const origin = within(() => createStopElement({ label: "発", kind: "origin" }));
    expect(origin.getAttribute("aria-label")).toBe("出発地");
  });
});
