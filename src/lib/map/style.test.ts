import { describe, expect, it } from "vitest";
import { applyJapaneseLabels, JAPANESE_TEXT_FIELD, type LabelStyleMap } from "./style";

function fakeMap(layers: { id: string; type: string; layout?: Record<string, unknown> }[]) {
  const calls: { id: string; value: unknown }[] = [];
  const map: LabelStyleMap = {
    getStyle: () => ({ layers }),
    setLayoutProperty: (id, _name, value) => calls.push({ id, value }),
  };
  return { map, calls };
}

describe("applyJapaneseLabels", () => {
  it("name を参照する symbol レイヤーだけ name:ja 優先の式に置き換える", () => {
    const { map, calls } = fakeMap([
      { id: "place", type: "symbol", layout: { "text-field": "{name:latin}\n{name:nonlatin}" } },
      {
        id: "poi",
        type: "symbol",
        layout: { "text-field": ["coalesce", ["get", "name:latin"], ["get", "name"]] },
      },
      { id: "shield", type: "symbol", layout: { "text-field": "{ref}" } },
      { id: "road", type: "line" },
      { id: "icon-only", type: "symbol", layout: { "icon-image": "x" } },
    ]);
    expect(applyJapaneseLabels(map)).toEqual(["place", "poi"]);
    expect(calls).toHaveLength(2);
    expect(calls[0].value).toEqual([...JAPANESE_TEXT_FIELD]);
  });
  it("スタイル未取得なら何もしない", () => {
    const map: LabelStyleMap = { getStyle: () => undefined, setLayoutProperty: () => {} };
    expect(applyJapaneseLabels(map)).toEqual([]);
  });
});
