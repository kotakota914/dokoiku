-- =============================================================================
-- スモークテスト：migration と seed のあとに流し、期待どおりでなければ例外で止める
-- =============================================================================

\set ON_ERROR_STOP on

-- ---------- 1. 金沢（金沢市・野々市市）の範囲に seed のスポットが全件（40 件以上）ある ----------
do $$
declare
  v_count int;
  v_total int;
begin
  select count(*) into v_count from public.spots_in_bbox(136.55, 36.48, 136.75, 36.65);
  select count(*) into v_total from public.spots;
  if v_count <> v_total or v_count < 40 then
    raise exception 'spots_in_bbox: seed の % 件（40 件以上）のはずが % 件', v_total, v_count;
  end if;
  raise notice 'ok: spots_in_bbox で金沢の範囲に % 件', v_count;
end;
$$;

-- カテゴリで絞ると件数が減り、ヒートマップの点数は bbox と一致する
do $$
declare
  v_all int;
  v_history int;
  v_heat int;
begin
  select count(*) into v_all from public.spots_in_bbox(136.55, 36.48, 136.75, 36.65);
  select count(*) into v_history from public.spots_in_bbox(136.55, 36.48, 136.75, 36.65, array['history']);
  select count(*) into v_heat from public.spots_heatmap(136.55, 36.48, 136.75, 36.65);
  if v_history <= 0 or v_history >= v_all then
    raise exception 'spots_in_bbox: カテゴリ絞り込みが効いていない（all=%, history=%）', v_all, v_history;
  end if;
  if v_heat <> v_all then
    raise exception 'spots_heatmap: 点数 % が bbox の件数 % と一致しない', v_heat, v_all;
  end if;
  raise notice 'ok: カテゴリ絞り込み（history % 件）とヒートマップ（% 点）', v_history, v_heat;
end;
$$;

-- ---------- 2. 兼六園付近 300m の近傍検索 ----------
do $$
declare
  v_name text;
  v_distance float8;
begin
  select name, distance_m into v_name, v_distance
    from public.spots_nearby(36.5619, 136.6625, 300, 10)
   limit 1;
  if v_name is distinct from '兼六園' then
    raise exception 'spots_nearby: 先頭は兼六園のはずが %', coalesce(v_name, '（なし）');
  end if;
  if v_distance > 5 then
    raise exception 'spots_nearby: 兼六園までの距離 % m が大きすぎる', v_distance;
  end if;
  raise notice 'ok: spots_nearby 兼六園付近 300m の先頭は % （% m）', v_name, round(v_distance::numeric, 1);
end;
$$;

-- ---------- 3. recompute_spot_stats 後の統計 ----------
do $$
declare
  v_spot_id uuid;
  v_post_count int;
  v_actual int;
  v_cover uuid;
  v_hist_len int;
  v_hist_sum int;
  v_total int;
  v_total_posts int;
begin
  select id into v_spot_id from public.spots where name = '兼六園';
  perform public.recompute_spot_stats(v_spot_id);
  select post_count, cover_image_id, array_length(hour_histogram, 1),
         (select sum(x) from unnest(hour_histogram) x)
    into v_post_count, v_cover, v_hist_len, v_hist_sum
    from public.spots where id = v_spot_id;
  select count(*) into v_actual from public.posts where spot_id = v_spot_id and status = 'public';
  if v_post_count <> v_actual or v_post_count < 20 then
    raise exception 'recompute_spot_stats: 兼六園の post_count=% （実際 %、20 以上のはず）', v_post_count, v_actual;
  end if;
  if v_cover is null then
    raise exception 'recompute_spot_stats: 代表写真が設定されていない';
  end if;
  if v_hist_len <> 24 or v_hist_sum <> v_actual then
    raise exception 'recompute_spot_stats: hour_histogram が不正（len=%, sum=%）', v_hist_len, v_hist_sum;
  end if;
  select sum(post_count), (select count(*) from public.posts where status = 'public') into v_total, v_total_posts from public.spots;
  if v_total <> v_total_posts then
    raise exception 'recompute_spot_stats: post_count の合計 % が投稿数 % と一致しない', v_total, v_total_posts;
  end if;
  raise notice 'ok: recompute_spot_stats 兼六園 post_count=% cover=% 合計=%', v_post_count, v_cover, v_total;
end;
$$;

-- ---------- 4. 名前の類似検索と検索関数 ----------
do $$
declare
  v_count int;
begin
  -- 表記ゆれ（スペース・カタカナ）を吸収して兼六園が見つかる
  select count(*) into v_count from public.spots_similar_name('けんろく園', 36.5619, 136.6625, 50);
  if v_count <> 0 then
    raise exception 'spots_similar_name: ひらがな表記は漢字と一致しない想定（% 件）', v_count;
  end if;
  select count(*) into v_count from public.spots_similar_name('兼 六 園', 36.5619, 136.6625, 50);
  if v_count <> 1 then
    raise exception 'spots_similar_name: 「兼 六 園」で 1 件のはずが % 件', v_count;
  end if;
  select count(*) into v_count from public.spots_search(p_keyword => '神社', p_sort => 'popular', p_limit => 50);
  if v_count <> 3 then
    raise exception 'spots_search: 「神社」で 3 件のはずが % 件', v_count;
  end if;
  select count(*) into v_count from public.spots_search(p_city => '金沢市', p_category => 'gourmet', p_sort => 'newest', p_limit => 50);
  if v_count <> 5 then
    raise exception 'spots_search: 金沢市のグルメは 5 件のはずが % 件', v_count;
  end if;
  select count(*) into v_count from public.spots_search(p_city => '野々市市', p_sort => 'popular', p_limit => 50);
  if v_count < 6 then
    raise exception 'spots_search: 野々市市（金沢工業大学など）は 6 件以上のはずが % 件', v_count;
  end if;
  raise notice 'ok: spots_similar_name と spots_search';
end;
$$;

-- ---------- 5. api_usage / count_recent_posts ----------
do $$
declare
  v_usage public.api_usage;
  v_recent int;
begin
  v_usage := public.increment_api_usage('nominatim', 'external_search', '2026-10-10', 500);
  v_usage := public.increment_api_usage('nominatim', 'external_search', '2026-10-10', 500, 2);
  if v_usage.count <> 3 or v_usage."limit" <> 500 then
    raise exception 'increment_api_usage: count=% limit=%', v_usage.count, v_usage."limit";
  end if;
  delete from public.api_usage where provider = 'nominatim';
  select public.count_recent_posts('a0000000-0000-4000-8000-000000000001', timestamptz '2025-01-01 00:00:00+09') into v_recent;
  if v_recent <> (select count(*) from public.posts where user_id = 'a0000000-0000-4000-8000-000000000001') then
    raise exception 'count_recent_posts: % 件', v_recent;
  end if;
  raise notice 'ok: increment_api_usage と count_recent_posts';
end;
$$;

-- ---------- 6. RLS：本人の投稿は hidden でも見え、他人の hidden は見えない ----------
-- 検証用のユーザー 2 人と投稿を作る（superuser として）
insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'rls-a@example.com', '{}'::jsonb),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'rls-b@example.com', '{}'::jsonb)
on conflict (id) do nothing;
insert into public.profiles (id, display_name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'RLS検証A'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'RLS検証B')
on conflict (id) do nothing;
insert into public.posts (id, user_id, spot_id, comment, category, status) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from public.spots where name = '兼六園'), 'Aの公開投稿', 'history', 'public'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from public.spots where name = '兼六園'), 'Aの非表示投稿', 'history', 'hidden'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', (select id from public.spots where name = '兼六園'), 'Bの非表示投稿', 'history', 'hidden')
on conflict (id) do nothing;

-- A としてログインした状態
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

do $$
declare
  v_own int;
  v_other_hidden int;
  v_updated int;
begin
  select count(*) into v_own from public.posts where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if v_own <> 2 then
    raise exception 'RLS: 自分の投稿（公開＋非表示）は 2 件見えるはずが % 件', v_own;
  end if;
  select count(*) into v_other_hidden from public.posts where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  if v_other_hidden <> 0 then
    raise exception 'RLS: 他人の非表示投稿が % 件見えている', v_other_hidden;
  end if;
  -- 他人の投稿は更新できない（対象 0 行）
  update public.posts set comment = '改ざん' where id = 'bbbbbbbb-0000-4000-8000-000000000001';
  get diagnostics v_updated = row_count;
  if v_updated <> 0 then
    raise exception 'RLS: 他人の投稿を更新できてしまった';
  end if;
  -- 自分の投稿は更新できる
  update public.posts set comment = 'Aの公開投稿（更新）' where id = 'aaaaaaaa-0000-4000-8000-000000000001';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'RLS: 自分の投稿を更新できない';
  end if;
  -- いいねできる（トリガーで like_count が増える）
  insert into public.likes (user_id, post_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-0000-4000-8000-000000000001');
  if (select like_count from public.posts where id = 'aaaaaaaa-0000-4000-8000-000000000001') <> 1 then
    raise exception 'RLS: いいね後の like_count が 1 でない';
  end if;
  -- 自分のリストを作れる
  insert into public.wishlists (user_id, name) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '検証リスト');
  -- reports は policy がないので認証ユーザーからは読めない（0 行）
  raise notice 'ok: RLS（本人の投稿 % 件、他人の hidden % 件、更新・いいね・リスト作成）', v_own, v_other_hidden;
end;
$$;

-- 未ログイン（anon）では hidden が 1 件も見えない
reset role;
reset request.jwt.claim.sub;
set role anon;
do $$
declare
  v_hidden int;
begin
  select count(*) into v_hidden from public.posts where status = 'hidden';
  if v_hidden <> 0 then
    raise exception 'RLS: 未ログインで hidden が % 件見えている', v_hidden;
  end if;
  raise notice 'ok: RLS（未ログインでは hidden が見えない）';
end;
$$;
reset role;

-- 検証用データを片付ける（auth.users の削除で profiles 以下は cascade）
delete from auth.users where id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
do $$ begin perform public.recompute_spot_stats((select id from public.spots where name = '兼六園')); end; $$;

-- ---------- 7. Storage（0002 を流した場合のみ） ----------
do $$
begin
  if exists (select 1 from storage.buckets where id = 'post-images' and public) then
    raise notice 'ok: storage バケット post-images（公開）';
  else
    raise notice 'skip: storage バケットは未作成（0002_storage.sql を省略）';
  end if;
end;
$$;
