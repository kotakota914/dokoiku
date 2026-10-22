-- =============================================================================
-- v0.3（要件定義書 2026/10/21 更新）のスキーマ変更
-- - spots.popularity（F-1-5：市区町村内の相対順位）と recompute_popularity()
-- - spots.source に 'seed' を追加（10.5：初期データ）
-- - wishlists.base_label / base_location（F-4-8：拠点）
-- - plans.method（作り方：auto / preferences / chat）
-- - travel_time_cache.time_bucket（公共交通の出発時刻の区分）と mode に 'transit'、主キーの変更
-- - api_usage.feature に 'route_planning_transit' / 'ai_chat'
-- - 要約を返す RPC（spots_in_bbox / spots_nearby / spots_search）に popularity 列を追加
-- RLS の方針（10.3）は変えない：wishlists / plans は本人のみ、travel_time_cache / api_usage はサーバーのみ。
-- 何度流しても同じ結果になるよう if not exists / drop if exists を使う。
-- =============================================================================

-- ---------- spots ----------
-- 人気度（F-1-5）。recompute_popularity() が更新する。既定は通常
alter table public.spots add column if not exists popularity text not null default 'normal';
alter table public.spots drop constraint if exists spots_popularity_check;
alter table public.spots add constraint spots_popularity_check
  check (popularity in ('normal', 'popular', 'very_popular'));

-- 登録元に初期データ（seed）を追加
alter table public.spots drop constraint if exists spots_source_check;
alter table public.spots add constraint spots_source_check
  check (source in ('gps', 'search_db', 'search_external', 'seed'));

-- 順位計算（市区町村・都道府県ごとの集計）用
create index if not exists spots_prefecture_city_idx on public.spots (prefecture, city);

-- ---------- wishlists（拠点、F-4-8） ----------
alter table public.wishlists add column if not exists base_label text;
alter table public.wishlists add column if not exists base_location geography(Point, 4326);
alter table public.wishlists drop constraint if exists wishlists_base_label_check;
alter table public.wishlists add constraint wishlists_base_label_check
  check (base_label is null or char_length(base_label) between 1 and 100);
-- 名前と位置は両方そろえる（片方だけは不可）
alter table public.wishlists drop constraint if exists wishlists_base_pair_check;
alter table public.wishlists add constraint wishlists_base_pair_check
  check ((base_label is null) = (base_location is null));

-- ---------- plans（作り方） ----------
alter table public.plans add column if not exists method text not null default 'auto';
alter table public.plans drop constraint if exists plans_method_check;
alter table public.plans add constraint plans_method_check
  check (method in ('auto', 'preferences', 'chat'));

-- ---------- travel_time_cache（公共交通と出発時刻の区分、10.2） ----------
-- 既存行は 'any'（徒歩・車）
alter table public.travel_time_cache add column if not exists time_bucket text not null default 'any';
alter table public.travel_time_cache drop constraint if exists travel_time_cache_mode_check;
alter table public.travel_time_cache add constraint travel_time_cache_mode_check
  check (mode in ('transit', 'walking', 'driving'));
-- 主キーを (from_key, to_key, mode, time_bucket) にする
alter table public.travel_time_cache drop constraint if exists travel_time_cache_pkey;
alter table public.travel_time_cache add primary key (from_key, to_key, mode, time_bucket);
-- mode ごとの期限切れ削除（徒歩・車は 30 日、公共交通は 7 日）用
create index if not exists travel_time_cache_mode_fetched_idx on public.travel_time_cache (mode, fetched_at);

-- ---------- api_usage（F-8：公共交通の行列と AI の使用量） ----------
alter table public.api_usage drop constraint if exists api_usage_feature_check;
alter table public.api_usage add constraint api_usage_feature_check
  check (feature in ('external_search', 'route_planning', 'route_planning_transit', 'ai_chat', 'post_create'));

-- =============================================================================
-- 人気度の再計算（F-1-5、ADR-0025）。src/lib/domain/popularity.ts（memory 実装）と同じ規則
-- - 単位は市区町村（prefecture + city）。市区町村内の表示対象スポット（post_count > 0）が 10 件未満なら、
--   その都道府県の全スポットの中での順位を使う
-- - 投稿数の多い順に順位を付け（同数は同順位）、上位 10%（切り上げ）＝ very_popular、上位 30%（切り上げ）＝ popular
-- - 投稿 2 件未満は常に normal。投稿 0 件は母数に含めず normal
-- - p_prefecture を渡すとその都道府県だけ、p_city だけ渡すとその市区町村を含む都道府県だけを再計算する
-- - 戻り値は人気度が変わったスポット数
-- 定数（0.1 / 0.3 / 2 / 10）は src/lib/domain/constants.ts の POPULARITY_RANKING と合わせる
-- =============================================================================
create or replace function public.recompute_popularity(p_prefecture text default null, p_city text default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefs text[];
  v_changed int := 0;
  v_reset int := 0;
begin
  -- 対象の都道府県（null の都道府県は '' として扱う）。市区町村の順位も都道府県の中で完結するので都道府県単位で計算する
  select array_agg(distinct coalesce(s.prefecture, ''))
    into v_prefs
    from public.spots s
   where (p_prefecture is null and p_city is null)
      or (p_prefecture is not null and coalesce(s.prefecture, '') = p_prefecture)
      or (p_prefecture is null and p_city is not null and coalesce(s.city, '') = p_city);
  if v_prefs is null then
    return 0;
  end if;

  with pool as (
    select s.id,
           coalesce(s.prefecture, '') as pref,
           coalesce(s.city, '') as city,
           s.post_count
      from public.spots s
     where coalesce(s.prefecture, '') = any (v_prefs)
       and s.post_count > 0
  ),
  ranked as (
    -- 同数は同順位（rank）。母数は市区町村・都道府県それぞれの表示対象スポット数
    select id,
           post_count,
           count(*) over (partition by pref, city) as city_n,
           rank() over (partition by pref, city order by post_count desc) as city_rank,
           count(*) over (partition by pref) as pref_n,
           rank() over (partition by pref order by post_count desc) as pref_rank
      from pool
  ),
  scored as (
    -- スポットが 10 件未満の市区町村は都道府県単位の順位を使う
    select id,
           post_count,
           case when city_n >= 10 then city_n else pref_n end as n,
           case when city_n >= 10 then city_rank else pref_rank end as r
      from ranked
  ),
  nxt as (
    select id,
           case
             when post_count < 2 then 'normal'
             when r <= ceil(n * 0.1) then 'very_popular'
             when r <= ceil(n * 0.3) then 'popular'
             else 'normal'
           end as popularity
      from scored
  )
  update public.spots s
     set popularity = nxt.popularity
    from nxt
   where nxt.id = s.id
     and s.popularity is distinct from nxt.popularity;
  get diagnostics v_changed = row_count;

  -- 投稿が 0 件になったスポットは通常に戻す
  update public.spots s
     set popularity = 'normal'
   where coalesce(s.prefecture, '') = any (v_prefs)
     and s.post_count <= 0
     and s.popularity <> 'normal';
  get diagnostics v_reset = row_count;

  return v_changed + v_reset;
end;
$$;

-- 再計算はサーバー（service role）と Cron から呼ぶ
revoke execute on function public.recompute_popularity(text, text) from public;
grant execute on function public.recompute_popularity(text, text) to service_role;

-- =============================================================================
-- 要約を返す RPC に popularity 列を追加する（戻り値の形が変わるので作り直す）
-- =============================================================================
drop function if exists public.spots_in_bbox(float8, float8, float8, float8, text[], int);
create function public.spots_in_bbox(
  min_lng float8,
  min_lat float8,
  max_lng float8,
  max_lat float8,
  categories text[] default null,
  max_count int default 2000
)
returns table (
  id uuid,
  name text,
  lat float8,
  lng float8,
  category text,
  post_count int,
  like_count int,
  prefecture text,
  city text,
  cover_thumb_path text,
  popularity text
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    s.id,
    s.name,
    ST_Y(s.location::geometry) as lat,
    ST_X(s.location::geometry) as lng,
    s.category,
    s.post_count,
    s.like_count,
    s.prefecture,
    s.city,
    (select pi.thumb_path from public.post_images pi where pi.id = s.cover_image_id) as cover_thumb_path,
    s.popularity
  from public.spots s
  where s.post_count > 0
    and s.location::geometry && ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)
    and (categories is null or s.category = any (categories))
  order by s.post_count desc, s.like_count desc, s.created_at desc
  limit greatest(coalesce(max_count, 2000), 1);
$$;

drop function if exists public.spots_nearby(float8, float8, float8, int);
create function public.spots_nearby(
  p_lat float8,
  p_lng float8,
  radius_m float8,
  max_count int default 10
)
returns table (
  id uuid,
  name text,
  lat float8,
  lng float8,
  category text,
  post_count int,
  like_count int,
  prefecture text,
  city text,
  cover_thumb_path text,
  popularity text,
  distance_m float8
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    s.id,
    s.name,
    ST_Y(s.location::geometry) as lat,
    ST_X(s.location::geometry) as lng,
    s.category,
    s.post_count,
    s.like_count,
    s.prefecture,
    s.city,
    (select pi.thumb_path from public.post_images pi where pi.id = s.cover_image_id) as cover_thumb_path,
    s.popularity,
    ST_Distance(s.location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) as distance_m
  from public.spots s
  where ST_DWithin(s.location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, radius_m)
  order by distance_m asc, s.post_count desc
  limit greatest(coalesce(max_count, 10), 1);
$$;

drop function if exists public.spots_search(text, text, text, text, text, int, int, timestamptz, uuid);
create function public.spots_search(
  p_keyword text default null,
  p_prefecture text default null,
  p_city text default null,
  p_category text default null,
  p_sort text default 'popular',
  p_limit int default 20,
  p_cursor_score int default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
)
returns table (
  id uuid,
  name text,
  lat float8,
  lng float8,
  category text,
  post_count int,
  like_count int,
  prefecture text,
  city text,
  cover_thumb_path text,
  popularity text,
  score int,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  -- memory 実装（SpotsRepo.search）と同じ部分一致：都道府県・市区町村は含む一致、キーワードは名前・住所・都道府県・市区町村のいずれか（F3-07）
  with q as (
    select
      '%' || replace(replace(replace(coalesce(p_keyword, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern,
      '%' || replace(replace(replace(coalesce(p_prefecture, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pref_pattern,
      '%' || replace(replace(replace(coalesce(p_city, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%' as city_pattern
  ),
  base as (
    select s.*, (s.post_count + s.like_count) as score, q.pattern
    from public.spots s, q
    where s.post_count > 0
      and (p_category is null or s.category = p_category)
      and (p_prefecture is null or p_prefecture = '' or coalesce(s.prefecture, '') ilike q.pref_pattern)
      and (p_city is null or p_city = '' or coalesce(s.city, '') ilike q.city_pattern or coalesce(s.address, '') ilike q.city_pattern)
  )
  select
    b.id,
    b.name,
    ST_Y(b.location::geometry) as lat,
    ST_X(b.location::geometry) as lng,
    b.category,
    b.post_count,
    b.like_count,
    b.prefecture,
    b.city,
    (select pi.thumb_path from public.post_images pi where pi.id = b.cover_image_id) as cover_thumb_path,
    b.popularity,
    b.score,
    b.created_at
  from base b
  where (
      p_keyword is null or p_keyword = ''
      or b.name ilike b.pattern
      or coalesce(b.address, '') ilike b.pattern
      or coalesce(b.prefecture, '') ilike b.pattern
      or coalesce(b.city, '') ilike b.pattern
    )
    and (
      p_cursor_id is null
      or (p_sort = 'newest' and (b.created_at, b.id) < (p_cursor_created_at, p_cursor_id))
      or (p_sort <> 'newest' and (b.score, b.created_at, b.id) < (coalesce(p_cursor_score, 0), p_cursor_created_at, p_cursor_id))
    )
  order by
    case when p_sort = 'newest' then 0 else b.score end desc,
    b.created_at desc,
    b.id desc
  limit greatest(coalesce(p_limit, 20), 1);
$$;

-- 作り直した関数の実行権限（0001 と同じ：読み取り系は全員）
grant execute on function public.spots_in_bbox(float8, float8, float8, float8, text[], int) to anon, authenticated, service_role;
grant execute on function public.spots_nearby(float8, float8, float8, int) to anon, authenticated, service_role;
grant execute on function public.spots_search(text, text, text, text, text, int, int, timestamptz, uuid) to anon, authenticated, service_role;

-- 既存データの人気度を一度計算しておく（以降は投稿の作成・削除後と 1 時間ごとの Cron で更新）
do $$ begin perform public.recompute_popularity(); end; $$;

-- =============================================================================
-- 定期処理（12章）は pg_cron で登録する。pg_cron は Supabase Dashboard（Database > Extensions）で
-- 有効にする必要があり、ローカル検証環境には無いことが多いので、この migration では登録しない。
-- 手順は docs/supabase-setup.md「10. 定期処理（pg_cron）」を参照：
--   select cron.schedule('recompute-popularity', '0 * * * *', $$select public.recompute_popularity();$$);
-- =============================================================================
