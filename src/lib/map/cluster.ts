/**
 * 写真の束（F-1-4）の純粋ロジック。Supercluster でスポットを束ね、
 * 束ごとの投稿数の合計と代表写真（投稿数が最大のスポットの写真）を集計する。
 */
import Supercluster, { type ClusterFeature, type PointFeature } from "supercluster";
import { CLUSTER_STYLE, MAP_ZOOM, type Category, type Popularity } from "@/lib/domain/constants";
import type { SpotSummary } from "@/lib/domain/types";
import type { MapBbox } from "./view";

/** 各点（スポット）の properties */
export type SpotPointProps = {
  spotId: string;
  name: string;
  category: Category;
  postCount: number;
  popularity: Popularity;
  coverThumbUrl: string | null;
};

/** 束の集計値（map/reduce の結果） */
export type ClusterAggProps = {
  /** 束に含まれるスポットの投稿数の合計 */
  postCount: number;
  /** 代表写真。投稿数が最大のスポットの coverThumbUrl（写真があるものを優先） */
  coverThumbUrl: string | null;
  /** 代表写真を持つスポットの投稿数（reduce の比較用） */
  coverPostCount: number;
  /** 代表スポットの名前とカテゴリ（写真が無いときの代替アイコンとラベル用） */
  coverName: string;
  coverCategory: Category;
};

export type SpotClusterIndex = Supercluster<SpotPointProps, ClusterAggProps>;
export type SpotClusterFeature = ClusterFeature<ClusterAggProps>;
export type SpotPointFeature = PointFeature<SpotPointProps>;
export type ClusterItem = SpotClusterFeature | SpotPointFeature;

export const CLUSTER_RADIUS_PX = 60;

/** p の方が代表にふさわしいか（写真あり＞写真なし、次に投稿数） */
function isBetterCover(p: Readonly<ClusterAggProps>, acc: Readonly<ClusterAggProps>): boolean {
  const pHas = p.coverThumbUrl !== null;
  const aHas = acc.coverThumbUrl !== null;
  if (pHas !== aHas) return pHas;
  return p.coverPostCount > acc.coverPostCount;
}

export function buildClusterIndex(spots: readonly SpotSummary[]): SpotClusterIndex {
  const index = new Supercluster<SpotPointProps, ClusterAggProps>({
    radius: CLUSTER_RADIUS_PX,
    maxZoom: MAP_ZOOM.clusterMax,
    map: (p) => ({
      postCount: p.postCount,
      coverThumbUrl: p.coverThumbUrl,
      coverPostCount: p.postCount,
      coverName: p.name,
      coverCategory: p.category,
    }),
    reduce: (acc, p) => {
      acc.postCount += p.postCount;
      if (isBetterCover(p, acc)) {
        acc.coverThumbUrl = p.coverThumbUrl;
        acc.coverPostCount = p.coverPostCount;
        acc.coverName = p.coverName;
        acc.coverCategory = p.coverCategory;
      }
    },
  });
  index.load(
    spots.map((s) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [s.lng, s.lat] },
      properties: {
        spotId: s.id,
        name: s.name,
        category: s.category,
        postCount: s.postCount,
        popularity: s.popularity,
        coverThumbUrl: s.coverThumbUrl,
      },
    })),
  );
  return index;
}

/** 表示範囲とズームに応じた束と単独点 */
export function getClusters(index: SpotClusterIndex, bbox: MapBbox, zoom: number): ClusterItem[] {
  return index.getClusters([bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat], Math.floor(zoom));
}

export function isClusterFeature(item: ClusterItem): item is SpotClusterFeature {
  return (item.properties as { cluster?: boolean }).cluster === true;
}

/** マーカーの差分更新に使うキー */
export function clusterItemKey(item: ClusterItem): string {
  return isClusterFeature(item) ? `c:${item.properties.cluster_id}` : `s:${item.properties.spotId}`;
}

/** 束の見た目（単独点も同じ見た目なので共通） */
export interface ClusterView {
  key: string;
  lat: number;
  lng: number;
  postCount: number;
  coverThumbUrl: string | null;
  name: string;
  category: Category;
  /** 束に含まれるスポット数（単独なら 1） */
  spotCount: number;
  clusterId: number | null;
}

export function toClusterView(item: ClusterItem): ClusterView {
  const [lng, lat] = item.geometry.coordinates;
  if (isClusterFeature(item)) {
    const p = item.properties;
    return {
      key: `c:${p.cluster_id}`,
      lat,
      lng,
      postCount: p.postCount,
      coverThumbUrl: p.coverThumbUrl,
      name: p.coverName,
      category: p.coverCategory,
      spotCount: p.point_count,
      clusterId: p.cluster_id,
    };
  }
  const p = item.properties;
  return {
    key: `s:${p.spotId}`,
    lat,
    lng,
    postCount: p.postCount,
    coverThumbUrl: p.coverThumbUrl,
    name: p.name,
    category: p.category,
    spotCount: 1,
    clusterId: null,
  };
}

/** 束に含まれる全スポットを囲む bbox（タップ時のズームイン先） */
export function clusterBounds(index: SpotClusterIndex, clusterId: number): MapBbox {
  const leaves = index.getLeaves(clusterId, Infinity);
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const leaf of leaves) {
    const [lng, lat] = leaf.geometry.coordinates;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLng, minLat, maxLng, maxLat };
}

/** 束が分かれるズーム（タップ時のズーム先）。写真ピンに切り替わるズーム以上にはしない */
export function clusterExpansionZoom(index: SpotClusterIndex, clusterId: number): number {
  return Math.min(index.getClusterExpansionZoom(clusterId), MAP_ZOOM.pinMin);
}

export type ClusterStyle = (typeof CLUSTER_STYLE)[number];

/** F-1-4：投稿数に応じた重なり枚数とサイズ（1〜4 / 5〜19 / 20〜） */
export function clusterStyleFor(postCount: number): ClusterStyle {
  for (const style of CLUSTER_STYLE) {
    if (postCount <= style.maxPosts) return style;
  }
  return CLUSTER_STYLE[CLUSTER_STYLE.length - 1];
}
