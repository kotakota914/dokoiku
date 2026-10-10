/**
 * 経路作成ロジック（11章）の入出力型。
 * このディレクトリは純粋関数のみで、外部 API や Repository を import しない。
 */
import type { Category, Interest, Pace } from "@/lib/domain/constants";
import type { OpeningHours, PlanResult } from "@/lib/domain/types";

/** 経路計算に必要なスポット情報（SpotDetail とリストの mustVisit を合わせたもの） */
export interface PlannerSpot {
  id: string;
  name: string;
  lat: number;
  lng: number;
  category: Category;
  postCount: number;
  stayMinutesMedian: number | null;
  /** 24要素。投稿時刻（日本時間）の分布 */
  hourHistogram: number[];
  openingHours: OpeningHours | null;
  /** 「必ず行きたい」。時間が足りなくても外さない */
  mustVisit: boolean;
}

export interface TravelLeg {
  durationSec: number;
  distanceM: number;
}

/**
 * 移動時間行列。キーは `${fromKey}|${toKey}`。
 * 出発地・到着地は geo.ts の coordKey()、スポットは spotKey() で作る。
 * 区間が無い（経路が見つからない）ペアはキー自体が存在しない。
 */
export type TravelMatrix = Map<string, TravelLeg>;

export interface PlannerInput {
  spots: PlannerSpot[];
  /** coordKey(origin) */
  originKey: string;
  /** coordKey(destination)。到着地なしなら null */
  destinationKey: string | null;
  /** YYYY-MM-DD（営業時間の曜日判定に使う） */
  date: string;
  /** 開始・終了時刻（0:00 からの分） */
  startMin: number;
  endMin: number;
  pace: Pace;
  interests: Interest[];
  lunchBreak: boolean;
  /** ユーザーが変更した滞在時間（spotId → 分）。F-5-6 */
  stayOverrides?: Record<string, number>;
  matrix: TravelMatrix;
  /**
   * 訪問順をユーザーが固定したとき（F-5-6 の再計算）。spotId の配列。
   * 指定すると順番の探索を行わず、この順で時刻を計算する。入りきらなければ通常どおり外す。
   */
  fixedOrder?: string[];
}

/** PlanResult から外部 API 由来の項目（geometry / travelMatrixId / estimated）を除いたもの */
export type PlannerOutput = Omit<PlanResult, "geometry" | "travelMatrixId" | "estimated">;
