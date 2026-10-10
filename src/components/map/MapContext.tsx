"use client";

/**
 * SpotMap の子要素（現在地ボタンなど）から地図インスタンスを使うためのコンテキスト。
 * maplibre-gl 本体は import しない（型だけ）。SpotMap を読み込まない部品からも安全に import できる。
 */
import { createContext, useContext } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { LatLng } from "@/lib/domain/types";

export interface CurrentLocation extends LatLng {
  accuracyM: number;
}

export interface MapContextValue {
  /** 地図インスタンス。作成前・破棄後は null */
  map: MapLibreMap | null;
  /** スタイルの読み込みが終わり、レイヤー操作ができる状態か */
  ready: boolean;
  /** 現在地の青い点を表示・移動する（null で消す） */
  showLocation: (location: CurrentLocation | null) => void;
}

export const MapContext = createContext<MapContextValue>({
  map: null,
  ready: false,
  showLocation: () => {},
});

export function useMap(): MapContextValue {
  return useContext(MapContext);
}
