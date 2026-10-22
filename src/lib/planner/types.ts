/**
 * 経路作成ロジック（11章）の入出力型。
 * このディレクトリは純粋関数のみで、外部 API や Repository を import しない。
 */
import type { Category, TravelMode } from "@/lib/domain/constants";
import type { LatLng, OpeningHours, PlanCandidate, PlanPreferences } from "@/lib/domain/types";

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

/** 行列の 1 区間。外部 API 由来か概算かと、実際の移動手段（公共交通で取れず徒歩にした区間は walking）を持つ */
export interface TravelLeg {
  durationSec: number;
  distanceM: number;
  /** 直線距離からの概算なら true。省略時は false */
  estimated?: boolean;
  /** この区間の実際の移動手段。省略時はプランの移動手段 */
  mode?: TravelMode;
  /** 徒歩の距離（m）。省略時は mode が walking なら distanceM、それ以外は不明（null） */
  walkM?: number | null;
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
  /** 出発地・到着地の座標（geometry 用）。省略時は geometry にスポットの座標だけを入れる */
  origin?: LatLng;
  destination?: LatLng | null;
  /** YYYY-MM-DD（営業時間の曜日判定に使う） */
  date: string;
  /** 開始・終了時刻（0:00 からの分） */
  startMin: number;
  endMin: number;
  /** プランの移動手段（区間に mode が無いときの既定値、注意書きの判定） */
  mode: TravelMode;
  /** ペース・重視するもの・優先すること・時刻の指定・順番の希望・除外（F-5-4 / F-5-5） */
  preferences: PlanPreferences;
  lunchBreak: boolean;
  /** ユーザーが変更した滞在時間（spotId → 分）。F-5-10 */
  stayOverrides?: Record<string, number>;
  matrix: TravelMatrix;
}

/** planRoute の出力。候補は最大 PLAN_CANDIDATES_MAX 件。1 つも残らなければ空配列（skipped に全スポット） */
export interface PlannerOutput {
  candidates: PlanCandidate[];
  /** 候補に共通の除外（除外指定・経路なし・定休日・時間切れ）。各候補の skipped にも同じものが入る */
  skipped: PlanCandidate["skipped"];
}
