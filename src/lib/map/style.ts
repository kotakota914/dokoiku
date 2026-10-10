/**
 * 地図スタイル（OpenFreeMap）に関する設定。ADR-0009 相当。
 */

/** OpenFreeMap の Liberty スタイル（API キー不要） */
export const OPENFREEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

/** 日本語ラベルを優先する text-field 式（name:ja → name → name:latin） */
export const JAPANESE_TEXT_FIELD = [
  "coalesce",
  ["get", "name:ja"],
  ["get", "name"],
  ["get", "name:latin"],
] as const;

/** applyJapaneseLabels が必要とする最小限の地図インターフェース（テストで差し替えられる） */
export interface LabelStyleMap {
  getStyle(): { layers?: { id: string; type: string; layout?: Record<string, unknown> }[] } | undefined;
  setLayoutProperty(layerId: string, name: "text-field", value: unknown): void;
}

/** text-field が地名（name 系プロパティ）を参照しているか */
function refersToName(textField: unknown): boolean {
  if (typeof textField === "string") return /\{name/.test(textField);
  if (Array.isArray(textField)) return JSON.stringify(textField).includes('"name');
  return false;
}

/**
 * スタイル内の地名ラベルを `name:ja` 優先に置き換える。
 * 道路番号など name を参照しないラベルは変更しない。戻り値は変更したレイヤー ID。
 */
export function applyJapaneseLabels(map: LabelStyleMap): string[] {
  const layers = map.getStyle()?.layers ?? [];
  const changed: string[] = [];
  for (const layer of layers) {
    if (layer.type !== "symbol") continue;
    const textField = layer.layout?.["text-field"];
    if (!refersToName(textField)) continue;
    map.setLayoutProperty(layer.id, "text-field", [...JAPANESE_TEXT_FIELD]);
    changed.push(layer.id);
  }
  return changed;
}

/** CSS 変数（globals.css のトークン）の実際の値を読む。MapLibre のレイヤー色は CSS 変数を解釈しないため */
export function readCssToken(name: string, fallback: string): string {
  if (typeof window === "undefined" || typeof getComputedStyle !== "function") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}
