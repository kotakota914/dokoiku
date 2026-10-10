-- =============================================================================
-- 旅行どこいこう 初期スキーマ（要件定義書 10章・13章）
-- テーブル、インデックス、トリガー、RLS、RPC 関数をまとめて作る。
-- Storage 関連は 0002_storage.sql に分ける（ローカル検証では省略できる）。
-- =============================================================================

-- ---------- 拡張 ----------
-- PostGIS（位置情報）。Supabase で extensions スキーマに導入済みなら何もしない
create extension if not exists postgis;
-- pg_trgm（スポット名の部分一致検索用インデックス）
create extension if not exists pg_trgm;

-- ---------- 共通：updated_at の自動更新 ----------
-- 更新時に updated_at を現在時刻へ書き換えるトリガー関数
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------- profiles（auth.users と 1 対 1） ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  -- 表示名は 1〜20 文字（F-6-2）
  display_name text not null check (char_length(display_name) between 1 and 20),
  avatar_url text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- spots ----------
create table if not exists public.spots (
  id uuid primary key default gen_random_uuid(),
  -- スポット名は 1〜50 文字（F-2 入力チェック）
  name text not null check (char_length(name) between 1 and 50),
  -- 位置（WGS84 の点）
  location geography(Point, 4326) not null,
  address text,
  prefecture text,
  city text,
  -- 投稿で最も多いカテゴリ（recompute_spot_stats が更新する）
  category text not null check (category in ('nature', 'gourmet', 'history', 'photogenic', 'other')),
  -- 登録元：GPS / 自前DB検索 / 外部検索
  source text not null check (source in ('gps', 'search_db', 'search_external')),
  external_ref text,
  post_count int not null default 0,
  like_count int not null default 0,
  -- 代表写真（post_images.id）。投稿削除時に整合させるため FK は張らず関数で更新する
  cover_image_id uuid,
  stay_minutes_median int,
  -- 投稿時刻（日本時間）の 24 時間分布
  hour_histogram int[] not null default array_fill(0, array[24]),
  -- 営業時間（Q10：MVP では常に null）
  opening_hours jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- 近傍検索（ST_DWithin）用の GIST インデックス
create index if not exists spots_location_gist on public.spots using gist (location);
-- 表示範囲（bbox）検索用。geometry へのキャストは不変なので関数インデックスにできる
create index if not exists spots_location_geom_gist on public.spots using gist ((location::geometry));
-- スポット名の部分一致検索用（pg_trgm）
create index if not exists spots_name_trgm on public.spots using gin (name gin_trgm_ops);
-- 地図表示・検索の並び順（投稿数の多い順）
create index if not exists spots_post_count_idx on public.spots (post_count desc);

-- ---------- posts ----------
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  -- 退会時に投稿も削除（F-6-4）
  user_id uuid not null references public.profiles (id) on delete cascade,
  spot_id uuid not null references public.spots (id) on delete cascade,
  -- コメントは 150 文字以内（F-2-8）
  comment text not null default '' check (char_length(comment) <= 150),
  category text not null check (category in ('nature', 'gourmet', 'history', 'photogenic', 'other')),
  stay_duration text check (stay_duration is null or stay_duration in ('lt30', 'lt60', 'lt120', 'half_day')),
  like_count int not null default 0,
  -- 公開 / 非表示（通報 3 件で hidden、F-7-2）
  status text not null default 'public' check (status in ('public', 'hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- スポット詳細の投稿一覧（新着順）
create index if not exists posts_spot_created_idx on public.posts (spot_id, created_at desc);
-- マイページの投稿一覧（新着順）とレート制限の集計
create index if not exists posts_user_created_idx on public.posts (user_id, created_at desc);

-- 投稿の更新時に updated_at を自動更新
drop trigger if exists posts_set_updated_at on public.posts;
create trigger posts_set_updated_at
  before update on public.posts
  for each row execute function public.set_updated_at();

-- ---------- post_images ----------
create table if not exists public.post_images (
  id uuid primary key default gen_random_uuid(),
  -- 投稿削除時に連動削除
  post_id uuid not null references public.posts (id) on delete cascade,
  full_path text not null,
  thumb_path text not null,
  width int not null,
  height int not null,
  -- 並び順 0〜3（写真は最大 4 枚、F-2-3）
  sort_order smallint not null default 0 check (sort_order between 0 and 3)
);

create index if not exists post_images_post_idx on public.post_images (post_id, sort_order);

-- ---------- likes ----------
create table if not exists public.likes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  post_id uuid not null references public.posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- 同じ投稿へのいいねは 1 人 1 回（F-3-3）
  primary key (user_id, post_id)
);

create index if not exists likes_post_idx on public.likes (post_id);

-- いいねの増減を posts.like_count と spots.like_count に反映する（本人以外の投稿は RLS で更新できないため関数で行う）
create or replace function public.sync_like_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post_id uuid := coalesce(new.post_id, old.post_id);
  v_spot_id uuid;
begin
  update public.posts
     set like_count = (select count(*) from public.likes l where l.post_id = v_post_id)
   where id = v_post_id
   returning spot_id into v_spot_id;
  if v_spot_id is not null then
    update public.spots
       set like_count = (select coalesce(sum(p.like_count), 0) from public.posts p where p.spot_id = v_spot_id and p.status = 'public')
     where id = v_spot_id;
  end if;
  return null;
end;
$$;

drop trigger if exists likes_sync_count on public.likes;
create trigger likes_sync_count
  after insert or delete on public.likes
  for each row execute function public.sync_like_count();

-- ---------- wishlists ----------
create table if not exists public.wishlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- リスト名は 1〜30 文字（F-4-1）
  name text not null check (char_length(name) between 1 and 30),
  -- 共有用トークン（ランダム 32 文字）。null なら共有停止中
  share_token text unique,
  created_at timestamptz not null default now()
);

create index if not exists wishlists_user_idx on public.wishlists (user_id, created_at);

-- ---------- wishlist_items ----------
create table if not exists public.wishlist_items (
  wishlist_id uuid not null references public.wishlists (id) on delete cascade,
  spot_id uuid not null references public.spots (id) on delete cascade,
  -- 必ず行きたい（F-4-4）
  must_visit boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (wishlist_id, spot_id)
);

-- ---------- plans ----------
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  wishlist_id uuid not null references public.wishlists (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- 条件（PlanParams）
  params jsonb not null,
  -- 計算結果（PlanResult）
  result jsonb not null,
  total_travel_min int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists plans_wishlist_idx on public.plans (wishlist_id, created_at desc);

-- ---------- travel_time_cache（サーバー専用） ----------
create table if not exists public.travel_time_cache (
  -- スポット ID（s:...）または丸めた座標（c:lat,lng）
  from_key text not null,
  to_key text not null,
  mode text not null check (mode in ('walking', 'driving')),
  duration_sec int not null,
  distance_m int not null,
  -- 30 日で期限切れ（12章の定期処理で削除）
  fetched_at timestamptz not null default now(),
  primary key (from_key, to_key, mode)
);

create index if not exists travel_time_cache_fetched_idx on public.travel_time_cache (fetched_at);

-- ---------- api_usage（サーバー専用、F-8） ----------
create table if not exists public.api_usage (
  provider text not null,
  feature text not null check (feature in ('external_search', 'route_planning', 'post_create')),
  -- 2026-10（月）または 2026-10-10（日）
  period text not null,
  count bigint not null default 0,
  "limit" bigint not null default 0,
  suspended_at timestamptz,
  primary key (provider, feature, period)
);

-- ---------- reports（サーバー専用、F-7） ----------
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reason text not null check (reason in ('inappropriate_image', 'wrong_place', 'spam', 'other')),
  -- 補足は 100 文字まで（F-7-1）
  note text check (note is null or char_length(note) <= 100),
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  -- 同じ投稿への二重通報は不可
  unique (post_id, reporter_id)
);

create index if not exists reports_status_created_idx on public.reports (status, created_at desc);

-- =============================================================================
-- 権限（10.3）
-- =============================================================================

-- 管理者判定（policy から呼ぶ。security definer で profiles の RLS を介さず読む）
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false);
$$;

-- 全テーブルで RLS を有効化
alter table public.profiles enable row level security;
alter table public.spots enable row level security;
alter table public.posts enable row level security;
alter table public.post_images enable row level security;
alter table public.likes enable row level security;
alter table public.wishlists enable row level security;
alter table public.wishlist_items enable row level security;
alter table public.plans enable row level security;
alter table public.travel_time_cache enable row level security;
alter table public.api_usage enable row level security;
alter table public.reports enable row level security;

-- profiles：表示名・アイコンは全員が読める。作成・更新は本人のみ
drop policy if exists profiles_select_all on public.profiles;
create policy profiles_select_all on public.profiles for select using (true);
drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles for insert with check (id = auth.uid());
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- spots：読み取りは全員。作成は認証ユーザー（created_by は本人）。更新・削除は policy を作らない（統計更新は関数経由）
drop policy if exists spots_select_all on public.spots;
create policy spots_select_all on public.spots for select using (true);
drop policy if exists spots_insert_auth on public.spots;
create policy spots_insert_auth on public.spots for insert with check (auth.uid() is not null and created_by = auth.uid());

-- posts：公開中は全員、非表示は本人と管理者のみ読める。作成・更新・削除は本人のみ
drop policy if exists posts_select on public.posts;
create policy posts_select on public.posts for select
  using (status = 'public' or user_id = auth.uid() or public.is_admin());
drop policy if exists posts_insert_own on public.posts;
create policy posts_insert_own on public.posts for insert with check (user_id = auth.uid());
drop policy if exists posts_update_own on public.posts;
create policy posts_update_own on public.posts for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists posts_delete_own on public.posts;
create policy posts_delete_own on public.posts for delete using (user_id = auth.uid());

-- post_images：読み取りは全員。追加・削除は自分の投稿に対してのみ（F-2-12 の写真の追加削除）
drop policy if exists post_images_select_all on public.post_images;
create policy post_images_select_all on public.post_images for select using (true);
drop policy if exists post_images_insert_own on public.post_images;
create policy post_images_insert_own on public.post_images for insert
  with check (exists (select 1 from public.posts p where p.id = post_id and p.user_id = auth.uid()));
drop policy if exists post_images_delete_own on public.post_images;
create policy post_images_delete_own on public.post_images for delete
  using (exists (select 1 from public.posts p where p.id = post_id and p.user_id = auth.uid()));

-- likes：読み取りは全員。追加・取り消しは本人のみ
-- likes：件数は posts.like_count / spots.like_count（トリガー）で全員に公開する。行（誰が何にいいねしたか）は本人と管理者だけ（api-05）
drop policy if exists likes_select_all on public.likes;
drop policy if exists likes_select_own on public.likes;
create policy likes_select_own on public.likes for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists likes_insert_own on public.likes;
create policy likes_insert_own on public.likes for insert with check (user_id = auth.uid());
drop policy if exists likes_delete_own on public.likes;
create policy likes_delete_own on public.likes for delete using (user_id = auth.uid());

-- wishlists：本人のみ（共有リストは service role の API 経由なので policy 不要）
drop policy if exists wishlists_own on public.wishlists;
create policy wishlists_own on public.wishlists for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- wishlist_items：親リストの持ち主のみ
drop policy if exists wishlist_items_own on public.wishlist_items;
create policy wishlist_items_own on public.wishlist_items for all
  using (exists (select 1 from public.wishlists w where w.id = wishlist_id and w.user_id = auth.uid()))
  with check (exists (select 1 from public.wishlists w where w.id = wishlist_id and w.user_id = auth.uid()));

-- plans：親リストの持ち主のみ
drop policy if exists plans_own on public.plans;
create policy plans_own on public.plans for all
  using (exists (select 1 from public.wishlists w where w.id = wishlist_id and w.user_id = auth.uid()))
  with check (user_id = auth.uid() and exists (select 1 from public.wishlists w where w.id = wishlist_id and w.user_id = auth.uid()));

-- reports / api_usage / travel_time_cache：policy を作らない（service role のみが読み書きする）

-- テーブル権限（Supabase の既定と同じ範囲を明示する。ローカル検証の役割にも必要）
grant usage on schema public to anon, authenticated, service_role;
grant select on public.profiles, public.spots, public.posts, public.post_images, public.likes to anon, authenticated;
grant insert, update on public.profiles to authenticated;
grant insert on public.spots to authenticated;
grant insert, update, delete on public.posts to authenticated;
grant insert, delete on public.post_images to authenticated;
grant insert, delete on public.likes to authenticated;
grant select, insert, update, delete on public.wishlists, public.wishlist_items, public.plans to authenticated;
grant all on all tables in schema public to service_role;

-- =============================================================================
-- RPC 関数（すべて security definer、search_path 固定）
-- =============================================================================

-- 表記ゆれを吸収した比較用の文字列（小文字化、空白・記号の除去、カタカナをひらがなへ）
create or replace function public.normalize_spot_name(p_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select translate(
    lower(regexp_replace(coalesce(p_name, ''), '[[:space:]・･ー〜~_.,、。()（）「」『』-]', '', 'g')),
    'ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴヵヶ',
    'ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをんゔゕゖ'
  );
$$;

-- 表示範囲内のスポット要約（GET /spots）。公開投稿が 1 件以上あるものを投稿数の多い順に最大 max_count 件
create or replace function public.spots_in_bbox(
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
  cover_thumb_path text
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
    (select pi.thumb_path from public.post_images pi where pi.id = s.cover_image_id) as cover_thumb_path
  from public.spots s
  where s.post_count > 0
    and s.location::geometry && ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)
    and (categories is null or s.category = any (categories))
  order by s.post_count desc, s.like_count desc, s.created_at desc
  limit greatest(coalesce(max_count, 2000), 1);
$$;

-- ヒートマップ用の点（weight = 公開投稿数）
create or replace function public.spots_heatmap(
  min_lng float8,
  min_lat float8,
  max_lng float8,
  max_lat float8,
  categories text[] default null,
  max_count int default 2000
)
returns table (
  lat float8,
  lng float8,
  weight int
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    ST_Y(s.location::geometry) as lat,
    ST_X(s.location::geometry) as lng,
    s.post_count as weight
  from public.spots s
  where s.post_count > 0
    and s.location::geometry && ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)
    and (categories is null or s.category = any (categories))
  order by s.post_count desc
  limit greatest(coalesce(max_count, 2000), 1);
$$;

-- 現在地から radius_m 以内のスポットを近い順に（GET /spots/nearby）。投稿が 0 件でも候補に含める
create or replace function public.spots_nearby(
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
    ST_Distance(s.location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) as distance_m
  from public.spots s
  where ST_DWithin(s.location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, radius_m)
  order by distance_m asc, s.post_count desc
  limit greatest(coalesce(max_count, 10), 1);
$$;

-- 半径内で名前が似ているスポット（POST /posts の重複判定、Q7）
create or replace function public.spots_similar_name(
  p_name text,
  p_lat float8,
  p_lng float8,
  radius_m float8
)
returns setof public.spots
language sql
stable
security definer
set search_path = public, extensions
as $$
  select s.*
  from public.spots s
  where ST_DWithin(s.location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, radius_m)
    and public.normalize_spot_name(p_name) <> ''
    and (
      public.normalize_spot_name(s.name) like '%' || public.normalize_spot_name(p_name) || '%'
      or public.normalize_spot_name(p_name) like '%' || public.normalize_spot_name(s.name) || '%'
    )
  order by ST_Distance(s.location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography);
$$;

-- スポット検索（GET /spots/search）。キーワード・都道府県・市区町村・カテゴリで絞り込み、
-- 人気順（投稿数＋いいね）または新着順。カーソル（score, created_at, id）より後の行を返す
create or replace function public.spots_search(
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

-- スポット統計の再計算（F-2-13）。投稿の作成・編集・削除・いいねの後に呼ぶ
create or replace function public.recompute_spot_stats(p_spot_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_post_count int;
  v_like_count int;
  v_cover_image_id uuid;
  v_stay_count int;
  v_stay_median int;
  v_histogram int[];
  v_category text;
begin
  -- 公開投稿数といいね合計
  select count(*), coalesce(sum(p.like_count), 0)
    into v_post_count, v_like_count
    from public.posts p
   where p.spot_id = p_spot_id and p.status = 'public';

  -- 代表写真：いいねが最多（同数なら新しい）の公開投稿の 1 枚目
  select pi.id
    into v_cover_image_id
    from public.posts p
    join public.post_images pi on pi.post_id = p.id and pi.sort_order = 0
   where p.spot_id = p_spot_id and p.status = 'public'
   order by p.like_count desc, p.created_at desc
   limit 1;

  -- 滞在時間の中央値：滞在時間ありの公開投稿が 3 件以上のときだけ設定
  select count(*),
         percentile_disc(0.5) within group (
           order by case p.stay_duration
             when 'lt30' then 30
             when 'lt60' then 60
             when 'lt120' then 120
             when 'half_day' then 240
           end
         )
    into v_stay_count, v_stay_median
    from public.posts p
   where p.spot_id = p_spot_id and p.status = 'public' and p.stay_duration is not null;
  if v_stay_count < 3 then
    v_stay_median := null;
  end if;

  -- 時間帯分布：公開投稿の created_at を日本時間の時（0〜23）で集計
  select array_agg(coalesce(c.cnt, 0) order by h.hour)
    into v_histogram
    from generate_series(0, 23) as h(hour)
    left join (
      select extract(hour from (p.created_at at time zone 'Asia/Tokyo'))::int as hour, count(*)::int as cnt
        from public.posts p
       where p.spot_id = p_spot_id and p.status = 'public'
       group by 1
    ) c on c.hour = h.hour;

  -- 最頻カテゴリ（同数なら新しい投稿のカテゴリ）。公開投稿がなければ現状維持
  select p.category
    into v_category
    from public.posts p
   where p.spot_id = p_spot_id and p.status = 'public'
   group by p.category
   order by count(*) desc, max(p.created_at) desc
   limit 1;

  update public.spots s
     set post_count = v_post_count,
         like_count = v_like_count,
         cover_image_id = v_cover_image_id,
         stay_minutes_median = v_stay_median,
         hour_histogram = coalesce(v_histogram, array_fill(0, array[24])),
         category = coalesce(v_category, s.category)
   where s.id = p_spot_id;
end;
$$;

-- 外部 API の呼び出し回数を加算して最新行を返す（F-8-1）。初回は limit も保存する
create or replace function public.increment_api_usage(
  p_provider text,
  p_feature text,
  p_period text,
  p_limit bigint,
  p_by bigint default 1
)
returns public.api_usage
language sql
security definer
set search_path = public
as $$
  insert into public.api_usage (provider, feature, period, count, "limit")
  values (p_provider, p_feature, p_period, greatest(coalesce(p_by, 1), 0), coalesce(p_limit, 0))
  on conflict (provider, feature, period) do update
    set count = public.api_usage.count + greatest(coalesce(p_by, 1), 0)
  returning *;
$$;

-- 直近の投稿数（1 分 5 件のレート制限用、9.1）。非表示の投稿も数える
create or replace function public.count_recent_posts(p_user_id uuid, p_since timestamptz)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.posts p where p.user_id = p_user_id and p.created_at >= p_since;
$$;

-- ---------- 関数の実行権限 ----------
-- 読み取り系は全員から呼べる（地図・検索はログイン不要、F-6-5）
grant execute on function public.is_admin() to anon, authenticated, service_role;
grant execute on function public.normalize_spot_name(text) to anon, authenticated, service_role;
grant execute on function public.spots_in_bbox(float8, float8, float8, float8, text[], int) to anon, authenticated, service_role;
grant execute on function public.spots_heatmap(float8, float8, float8, float8, text[], int) to anon, authenticated, service_role;
grant execute on function public.spots_nearby(float8, float8, float8, int) to anon, authenticated, service_role;
grant execute on function public.spots_similar_name(text, float8, float8, float8) to anon, authenticated, service_role;
grant execute on function public.spots_search(text, text, text, text, text, int, int, timestamptz, uuid) to anon, authenticated, service_role;
-- 統計更新は認証ユーザーとサーバーから
revoke execute on function public.recompute_spot_stats(uuid) from public;
grant execute on function public.recompute_spot_stats(uuid) to authenticated, service_role;
-- 無料枠とレート制限の集計はサーバー（service role）だけ
revoke execute on function public.increment_api_usage(text, text, text, bigint, bigint) from public;
grant execute on function public.increment_api_usage(text, text, text, bigint, bigint) to service_role;
revoke execute on function public.count_recent_posts(uuid, timestamptz) from public;
grant execute on function public.count_recent_posts(uuid, timestamptz) to service_role;
-- トリガー関数は直接呼ばせない
revoke execute on function public.set_updated_at() from public;
revoke execute on function public.sync_like_count() from public;
