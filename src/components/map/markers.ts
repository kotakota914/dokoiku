/**
 * 地図マーカーの DOM を作る純粋な関数群（React コンポーネントではない）。
 * MapLibre の Marker({ element }) に渡す要素を作り、差分更新のために update 関数も用意する。
 * アイコンは lucide-react を小さな React ルートで描画する（8.1：アイコンは Lucide のみ）。
 */
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Aperture, Flame, Landmark, MapPin, Trees, Utensils, type LucideIcon } from "lucide-react";
import { PIN_THUMB_SIZE, POPULARITY_LABELS, type Category, type Popularity } from "@/lib/domain/constants";
import { clusterStyleFor } from "@/lib/map/cluster";
import type { RouteStopKind } from "@/lib/map/route";

/** 8.1 の対応表：カテゴリ → lucide-react のアイコン */
export const CATEGORY_ICON_COMPONENTS: Record<Category, LucideIcon> = {
  nature: Trees,
  gourmet: Utensils,
  history: Landmark,
  photogenic: Aperture,
  other: MapPin,
};

/** 人気度 → 枠の色（globals.css のトークン） */
export const POPULARITY_BORDER_VAR: Record<Popularity, string> = {
  normal: "var(--color-popularity-normal)",
  popular: "var(--color-popularity-popular)",
  very_popular: "var(--color-popularity-very)",
};

/** 写真ピンの枠の太さ（px）。選択中は太くする */
export const PIN_BORDER_PX = 3;
export const PIN_BORDER_SELECTED_PX = 5;
/** ボタン全体（タップ領域）の大きさ。8.1：44px 以上 */
export const PIN_TAP_SIZE = 56;

// ---------- 内部ユーティリティ ----------

const roots = new WeakMap<HTMLElement, Set<Root>>();

function mountIcon(holder: HTMLElement, Icon: LucideIcon, size: number, owner: HTMLElement): void {
  const root = createRoot(holder);
  root.render(createElement(Icon, { size, strokeWidth: 2, "aria-hidden": true }));
  let set = roots.get(owner);
  if (!set) {
    set = new Set();
    roots.set(owner, set);
  }
  set.add(root);
}

/** マーカー要素を捨てるときに呼ぶ（React ルートを解放する） */
export function disposeMarkerElement(el: HTMLElement): void {
  const set = roots.get(el);
  if (!set) return;
  roots.delete(el);
  // 他のルートの描画中に unmount すると警告が出るため、次のタスクで解放する
  setTimeout(() => {
    for (const root of set) root.unmount();
  }, 0);
}

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  return el;
}

function formatCount(n: number): string {
  return n.toLocaleString("ja-JP");
}

/** 写真（img）と、読み込み失敗時のカテゴリアイコンの組 */
interface PhotoSlot {
  frame: HTMLElement;
  img: HTMLImageElement;
  fallback: HTMLElement;
  src: string | null;
  category: Category;
  fallbackMounted: boolean;
}

const photoSlots = new WeakMap<HTMLElement, PhotoSlot>();

function createPhotoSlot(
  frame: HTMLElement,
  owner: HTMLElement,
  src: string | null,
  category: Category,
  iconSize: number,
): PhotoSlot {
  const img = make("img", "dk-marker__img block h-full w-full object-cover");
  img.alt = "";
  img.draggable = false;
  img.decoding = "async";
  img.loading = "lazy";
  const fallback = make(
    "span",
    "dk-marker__fallback hidden h-full w-full items-center justify-center bg-surface-muted text-text-muted",
  );
  fallback.dataset.category = category;
  const slot: PhotoSlot = { frame, img, fallback, src: null, category, fallbackMounted: false };
  img.addEventListener("error", () => showFallback(slot, owner, iconSize));
  frame.append(img, fallback);
  photoSlots.set(frame, slot);
  setPhoto(slot, owner, src, category, iconSize);
  return slot;
}

function showFallback(slot: PhotoSlot, owner: HTMLElement, iconSize: number): void {
  slot.img.classList.add("hidden");
  slot.fallback.classList.remove("hidden");
  slot.fallback.classList.add("flex");
  slot.frame.dataset.fallback = "true";
  if (!slot.fallbackMounted) {
    slot.fallbackMounted = true;
    mountIcon(slot.fallback, CATEGORY_ICON_COMPONENTS[slot.category], iconSize, owner);
  }
}

function setPhoto(
  slot: PhotoSlot,
  owner: HTMLElement,
  src: string | null,
  category: Category,
  iconSize: number,
): void {
  if (slot.category !== category && slot.fallbackMounted) {
    // カテゴリが変わったらアイコンを作り直す（まれ）
    slot.fallback.replaceChildren();
    slot.fallbackMounted = false;
  }
  slot.category = category;
  slot.fallback.dataset.category = category;
  if (src === slot.src && (src !== null || slot.fallbackMounted)) return;
  slot.src = src;
  if (src) {
    slot.img.classList.remove("hidden");
    slot.fallback.classList.add("hidden");
    slot.fallback.classList.remove("flex");
    delete slot.frame.dataset.fallback;
    slot.img.src = src;
  } else {
    slot.img.removeAttribute("src");
    showFallback(slot, owner, iconSize);
  }
}

// ---------- 写真ピン（F-1-5） ----------

export interface PinSpec {
  spotId: string;
  name: string;
  postCount: number;
  popularity: Popularity;
  category: Category;
  coverThumbUrl: string | null;
  selected: boolean;
}

interface PinState {
  spec: PinSpec;
  frame: HTMLElement;
  flame: HTMLElement | null;
}

const pinStates = new WeakMap<HTMLElement, PinState>();

export function pinAriaLabel(spec: Pick<PinSpec, "name" | "postCount" | "popularity">): string {
  const base = `${spec.name}（投稿${formatCount(spec.postCount)}件）`;
  return spec.popularity === "normal" ? base : `${base}、${POPULARITY_LABELS[spec.popularity]}`;
}

function applyPinFrame(frame: HTMLElement, spec: PinSpec): void {
  frame.style.borderColor = POPULARITY_BORDER_VAR[spec.popularity];
  frame.style.borderWidth = `${spec.selected ? PIN_BORDER_SELECTED_PX : PIN_BORDER_PX}px`;
}

function createFlameBadge(owner: HTMLElement): HTMLElement {
  const badge = make(
    "span",
    "dk-pin__flame pointer-events-none absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-popularity-very text-on-primary shadow-sm ring-2 ring-surface",
  );
  badge.dataset.flame = "true";
  badge.setAttribute("aria-hidden", "true");
  mountIcon(badge, Flame, 12, owner);
  return badge;
}

/** 写真ピンの DOM（<button>）を作る */
export function createPinElement(spec: PinSpec): HTMLButtonElement {
  const button = make(
    "button",
    "dk-marker dk-pin flex cursor-pointer items-center justify-center border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-primary",
  );
  button.type = "button";
  button.style.width = `${PIN_TAP_SIZE}px`;
  button.style.height = `${PIN_TAP_SIZE}px`;
  button.dataset.spotId = spec.spotId;

  const frame = make(
    "span",
    "dk-pin__frame relative block overflow-hidden rounded-[var(--radius-card)] border-solid bg-surface shadow-md",
  );
  frame.style.width = `${PIN_THUMB_SIZE}px`;
  frame.style.height = `${PIN_THUMB_SIZE}px`;
  frame.style.boxSizing = "border-box";
  createPhotoSlot(frame, button, spec.coverThumbUrl, spec.category, 22);
  button.append(frame);

  const state: PinState = { spec, frame, flame: null };
  pinStates.set(button, state);
  applyPin(button, state, spec, true);
  return button;
}

/** 既存の写真ピンを新しい内容に更新する（変わっていない部分は触らない） */
export function updatePinElement(button: HTMLElement, spec: PinSpec): void {
  const state = pinStates.get(button);
  if (!state) return;
  applyPin(button, state, spec, false);
}

function applyPin(button: HTMLElement, state: PinState, spec: PinSpec, force: boolean): void {
  const prev = state.spec;
  if (
    force ||
    prev.name !== spec.name ||
    prev.postCount !== spec.postCount ||
    prev.popularity !== spec.popularity
  ) {
    button.setAttribute("aria-label", pinAriaLabel(spec));
    button.title = spec.name;
  }
  if (force || prev.popularity !== spec.popularity || prev.selected !== spec.selected) {
    applyPinFrame(state.frame, spec);
    button.dataset.popularity = spec.popularity;
    if (spec.selected) button.dataset.selected = "true";
    else delete button.dataset.selected;
    button.setAttribute("aria-pressed", spec.selected ? "true" : "false");
    button.style.zIndex = spec.selected ? "2" : spec.popularity === "very_popular" ? "1" : "0";
  }
  const wantFlame = spec.popularity === "very_popular";
  if (wantFlame && !state.flame) {
    state.flame = createFlameBadge(button);
    button.append(state.flame);
  } else if (!wantFlame && state.flame) {
    state.flame.remove();
    state.flame = null;
  }
  button.dataset.category = spec.category;
  const slot = photoSlots.get(state.frame);
  if (slot) setPhoto(slot, button, spec.coverThumbUrl, spec.category, 22);
  state.spec = spec;
}

// ---------- 写真の束（F-1-4） ----------

export interface ClusterSpec {
  key: string;
  /** 束に含まれる投稿数の合計 */
  postCount: number;
  /** 束に含まれるスポット数（単独なら 1） */
  spotCount: number;
  /** 代表写真 */
  coverThumbUrl: string | null;
  /** 代表スポットの名前（読み上げ用） */
  name: string;
  category: Category;
}

interface ClusterState {
  spec: ClusterSpec;
  size: number;
  layers: number;
  stack: HTMLElement;
  front: HTMLElement;
  badge: HTMLElement;
}

const clusterStates = new WeakMap<HTMLElement, ClusterState>();

export function clusterAriaLabel(spec: Pick<ClusterSpec, "name" | "postCount" | "spotCount">): string {
  const count = `投稿${formatCount(spec.postCount)}件`;
  if (spec.spotCount <= 1) return `${spec.name}（${count}）`;
  return `${spec.name} ほか${formatCount(spec.spotCount - 1)}か所（${count}）。タップで拡大`;
}

/** 後ろの紙の重ね方（枚数ごとの transform） */
const BACK_LAYER_TRANSFORMS = ["rotate(-8deg) translate(-6%, 6%)", "rotate(7deg) translate(6%, -5%)"];

function buildStack(button: HTMLElement, state: ClusterState | null, spec: ClusterSpec): ClusterState {
  const { layers, size } = clusterStyleFor(spec.postCount);
  const stack = make("span", "dk-cluster__stack relative block");
  stack.style.width = `${size}px`;
  stack.style.height = `${size}px`;
  for (let i = layers - 1; i >= 1; i--) {
    const back = make(
      "span",
      "dk-cluster__card absolute inset-0 block rounded-[var(--radius-card)] border-2 border-surface bg-surface-muted shadow-md",
    );
    back.style.transform = BACK_LAYER_TRANSFORMS[i - 1] ?? "";
    back.dataset.layer = String(i);
    stack.append(back);
  }
  const front = make(
    "span",
    "dk-cluster__card dk-cluster__front absolute inset-0 block overflow-hidden rounded-[var(--radius-card)] border-2 border-surface bg-surface shadow-md",
  );
  front.dataset.layer = "0";
  createPhotoSlot(front, button, spec.coverThumbUrl, spec.category, Math.round(size * 0.45));
  stack.append(front);

  const badge = make(
    "span",
    "dk-cluster__badge pointer-events-none absolute -bottom-1 -right-1 flex h-6 min-w-6 items-center justify-center rounded-full border border-border bg-surface px-1.5 text-[13px] font-semibold leading-none text-text shadow-sm",
  );
  badge.dataset.count = String(spec.postCount);
  badge.setAttribute("aria-hidden", "true");
  badge.textContent = formatCount(spec.postCount);
  stack.append(badge);

  if (state) state.stack.replaceWith(stack);
  else button.append(stack);
  button.dataset.layers = String(layers);
  button.dataset.size = String(size);
  button.style.width = `${Math.max(size, PIN_TAP_SIZE)}px`;
  button.style.height = `${Math.max(size, PIN_TAP_SIZE)}px`;
  return { spec, size, layers, stack, front, badge };
}

/** 写真の束の DOM（<button>）を作る。単独点（spotCount=1）も同じ見た目で 1 枚になる */
export function createClusterElement(spec: ClusterSpec): HTMLButtonElement {
  const button = make(
    "button",
    "dk-marker dk-cluster flex cursor-pointer items-center justify-center border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-primary",
  );
  button.type = "button";
  button.dataset.key = spec.key;
  button.setAttribute("aria-label", clusterAriaLabel(spec));
  button.title = spec.name;
  clusterStates.set(button, buildStack(button, null, spec));
  return button;
}

/** 既存の束を更新する。段階（枚数・サイズ）が変わったときだけ重ねを作り直す */
export function updateClusterElement(button: HTMLElement, spec: ClusterSpec): void {
  const state = clusterStates.get(button);
  if (!state) return;
  const prev = state.spec;
  const style = clusterStyleFor(spec.postCount);
  if (style.layers !== state.layers || style.size !== state.size) {
    clusterStates.set(button, buildStack(button, state, spec));
  } else {
    if (prev.postCount !== spec.postCount) {
      state.badge.textContent = formatCount(spec.postCount);
      state.badge.dataset.count = String(spec.postCount);
    }
    const slot = photoSlots.get(state.front);
    if (slot) setPhoto(slot, button, spec.coverThumbUrl, spec.category, Math.round(state.size * 0.45));
    state.spec = spec;
  }
  if (prev.name !== spec.name || prev.postCount !== spec.postCount || prev.spotCount !== spec.spotCount) {
    button.setAttribute("aria-label", clusterAriaLabel(spec));
    button.title = spec.name;
  }
  button.dataset.key = spec.key;
}

// ---------- 経路の番号マーカー（F-5-4） ----------

export interface StopSpec {
  label: string;
  kind: RouteStopKind;
  name?: string;
}

const STOP_KIND_CLASS: Record<RouteStopKind, string> = {
  spot: "bg-primary text-on-primary border-surface",
  origin: "bg-text text-on-primary border-surface",
  destination: "bg-text text-on-primary border-surface",
  lunch: "bg-warning-soft text-warning border-warning",
};

const STOP_KIND_LABEL: Record<RouteStopKind, string> = {
  spot: "スポット",
  origin: "出発地",
  destination: "到着地",
  lunch: "昼食",
};

export function stopAriaLabel(spec: StopSpec): string {
  const kind = STOP_KIND_LABEL[spec.kind];
  return spec.kind === "spot"
    ? `${spec.label}番目 ${spec.name ?? kind}`
    : `${kind} ${spec.name ?? ""}`.trim();
}

/** 番号付きの丸マーカー（タップ対象ではない） */
export function createStopElement(spec: StopSpec): HTMLElement {
  const el = make(
    "span",
    `dk-marker dk-stop flex h-8 min-w-8 items-center justify-center rounded-full border-2 px-1 text-base font-bold leading-none shadow-md ${STOP_KIND_CLASS[spec.kind]}`,
  );
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", stopAriaLabel(spec));
  el.dataset.kind = spec.kind;
  el.textContent = spec.label;
  return el;
}

export function updateStopElement(el: HTMLElement, spec: StopSpec): void {
  if (el.dataset.kind !== spec.kind) {
    for (const cls of Object.values(STOP_KIND_CLASS)) el.classList.remove(...cls.split(" "));
    el.classList.add(...STOP_KIND_CLASS[spec.kind].split(" "));
    el.dataset.kind = spec.kind;
  }
  if (el.textContent !== spec.label) el.textContent = spec.label;
  el.setAttribute("aria-label", stopAriaLabel(spec));
}

// ---------- 現在地の点 ----------

/** 現在地を示す青い点（精度円は別途 MapLibre レイヤーで描く） */
export function createLocationDotElement(): HTMLElement {
  const el = make(
    "span",
    "dk-marker dk-location block h-5 w-5 rounded-full bg-primary ring-4 ring-surface shadow-md",
  );
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", "現在地");
  return el;
}
