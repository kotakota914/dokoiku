/**
 * GET /api/v1/spots/tiles/{z}/{x}/{y}?category=a,b（v0.3 9.3、F-1-2、ADR-0024）
 * 地図用の区画（Web メルカトルのタイル）単位でスポットを返す。z は 8 / 11 / 14 のいずれか。
 * z=8 はヒートマップ用の点、それ以外はスポット一覧（1 区画最大 500 件、投稿数の多い順）。ログイン不要。
 * 同じ区画は結果が同じなので Cache-Control: public, max-age=60（TILE_CACHE_MAX_AGE_SEC）を付ける。
 * 旧 GET /spots?bbox= は互換のため残す（検索・リストの地図で使用）。
 */
import { json, parseQuery, route } from "@/lib/api/handler";
import { TILE_CACHE_MAX_AGE_SEC } from "@/lib/domain/constants";
import { getRepo } from "@/lib/repo";
import { getSpotsInTile } from "@/lib/services/spots";
import { tilePathSchema, tileQuerySchema } from "@/lib/validation/schemas";

type Params = { z: string; x: string; y: string };

export const GET = route<Params>(async (req, { params }) => {
  const tile = tilePathSchema.parse(await params);
  const query = parseQuery(req, tileQuerySchema);
  const repo = await getRepo();
  const body = await getSpotsInTile(repo, tile, query);
  return json(body, { headers: { "Cache-Control": `public, max-age=${TILE_CACHE_MAX_AGE_SEC}` } });
});
