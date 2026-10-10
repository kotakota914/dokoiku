/**
 * 投稿作成（S-04）・投稿編集（S-05）で共有する画面内の状態の型。
 */
import type { Category, StayDuration } from "@/lib/domain/constants";
import type { ConvertedImage } from "@/lib/images/convert";
import type { NewSpotInput } from "@/lib/validation/schemas";

/** 選択した写真 1 枚。変換中は converted / previewUrl が無い */
export interface PhotoItem {
  /** 画面内で一意なキー */
  id: string;
  fileName: string;
  status: "converting" | "ready";
  converted?: ConvertedImage;
  /** 変換後サムネイルの object URL（不要になったら revoke する） */
  previewUrl?: string;
}

export type PhotoUpdater = (prev: PhotoItem[]) => PhotoItem[];

/** 場所の選択結果（F-2-5）。既存スポットか新規スポットのどちらか */
export type LocationChoice =
  | { spotId: string; spotName: string; newSpot?: undefined }
  | { newSpot: NewSpotInput; spotId?: undefined; spotName?: undefined };

/** 内容入力（F-2-8〜F-2-10） */
export interface ContentValue {
  comment: string;
  category: Category | null;
  stayDuration: StayDuration | null;
}

export const EMPTY_CONTENT: ContentValue = { comment: "", category: null, stayDuration: null };

export function locationLabel(choice: LocationChoice): string {
  return choice.newSpot ? choice.newSpot.name : choice.spotName;
}
