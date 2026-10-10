-- =============================================================================
-- 開発用の初期データ（Q16：京都市内 40 スポット）
-- 何度流しても同じ結果になるよう、ID は名前から決定的に作り、on conflict do nothing にする。
-- 画像の実ファイルは後でチームが Storage の seed/<ローマ字>/<n>.webp に置く
-- （UI は読み込み失敗時にカテゴリアイコンで代替表示する）。
-- =============================================================================

begin;

-- ---------- サンプル投稿者 ----------
-- profiles は auth.users と 1 対 1 なので、先に auth.users へ同じ UUID の行を入れる。
-- 列はローカル検証のスタブでも動くよう id, email, raw_user_meta_data に限る
insert into auth.users (id, email, raw_user_meta_data)
values ('11111111-1111-4111-8111-111111111111', 'seed-user@example.com', '{"full_name": "サンプル投稿者"}'::jsonb)
on conflict (id) do nothing;

insert into public.profiles (id, display_name, avatar_url, is_admin)
values ('11111111-1111-4111-8111-111111111111', 'サンプル投稿者', null, false)
on conflict (id) do nothing;

-- ---------- スポット（名前・座標・区） ----------
create temp table seed_spots (
  ord int,
  romaji text,
  name text,
  lat float8,
  lng float8,
  ward text,
  category text,
  n_posts int
) on commit drop;

insert into seed_spots (ord, romaji, name, lat, lng, ward, category, n_posts) values
  ( 1, 'kiyomizudera',         '清水寺',             34.9949, 135.7850, '東山区', 'history',    3),
  ( 2, 'fushimi-inari',        '伏見稲荷大社',       34.9671, 135.7727, '伏見区', 'history',    3),
  ( 3, 'kinkakuji',            '金閣寺',             35.0394, 135.7292, '北区',   'history',    3),
  ( 4, 'ginkakuji',            '銀閣寺',             35.0270, 135.7982, '左京区', 'history',    2),
  ( 5, 'arashiyama-bamboo',    '嵐山 竹林の小径',    35.0170, 135.6713, '右京区', 'nature',     3),
  ( 6, 'togetsukyo',           '渡月橋',             35.0135, 135.6775, '右京区', 'photogenic', 2),
  ( 7, 'nijojo',               '二条城',             35.0142, 135.7481, '中京区', 'history',    2),
  ( 8, 'nishiki-market',       '錦市場',             35.0050, 135.7649, '中京区', 'gourmet',    3),
  ( 9, 'yasaka-jinja',         '八坂神社',           35.0037, 135.7786, '東山区', 'history',    2),
  (10, 'hanamikoji',           '祇園 花見小路',      35.0031, 135.7752, '東山区', 'photogenic', 3),
  (11, 'kyoto-gyoen',          '京都御苑',           35.0254, 135.7622, '上京区', 'nature',     2),
  (12, 'nanzenji',             '南禅寺',             35.0113, 135.7943, '左京区', 'history',    2),
  (13, 'tetsugaku-no-michi',   '哲学の道',           35.0205, 135.7959, '左京区', 'nature',     2),
  (14, 'heian-jingu',          '平安神宮',           35.0161, 135.7823, '左京区', 'history',    2),
  (15, 'sanjusangendo',        '三十三間堂',         34.9878, 135.7717, '東山区', 'history',    1),
  (16, 'toji',                 '東寺',               34.9806, 135.7476, '南区',   'history',    2),
  (17, 'nishi-honganji',       '西本願寺',           34.9923, 135.7514, '下京区', 'history',    1),
  (18, 'higashi-honganji',     '東本願寺',           34.9912, 135.7586, '下京区', 'history',    1),
  (19, 'kyoto-tower',          '京都タワー',         34.9875, 135.7593, '下京区', 'photogenic', 2),
  (20, 'kamogawa-delta',       '鴨川デルタ',         35.0302, 135.7726, '左京区', 'nature',     3),
  (21, 'shimogamo-jinja',      '下鴨神社',           35.0390, 135.7729, '左京区', 'history',    2),
  (22, 'kamigamo-jinja',       '上賀茂神社',         35.0600, 135.7527, '北区',   'history',    1),
  (23, 'ryoanji',              '龍安寺',             35.0345, 135.7183, '右京区', 'history',    2),
  (24, 'ninnaji',              '仁和寺',             35.0310, 135.7138, '右京区', 'history',    1),
  (25, 'kitano-tenmangu',      '北野天満宮',         35.0276, 135.7352, '上京区', 'history',    2),
  (26, 'tenryuji',             '天龍寺',             35.0157, 135.6738, '右京区', 'history',    2),
  (27, 'kodaiji',              '高台寺',             35.0007, 135.7812, '東山区', 'history',    1),
  (28, 'kenninji',             '建仁寺',             35.0003, 135.7736, '東山区', 'history',    1),
  (29, 'chionin',              '知恩院',             35.0055, 135.7826, '東山区', 'history',    1),
  (30, 'keage-incline',        '蹴上インクライン',   35.0120, 135.7898, '左京区', 'photogenic', 2),
  (31, 'kifune-jinja',         '貴船神社',           35.1219, 135.7628, '左京区', 'nature',     2),
  (32, 'kuramadera',           '鞍馬寺',             35.1181, 135.7708, '左京区', 'nature',     1),
  (33, 'kyoto-aquarium',       '京都水族館',         34.9875, 135.7465, '下京区', 'other',      2),
  (34, 'kyoto-railway-museum', '京都鉄道博物館',     34.9873, 135.7423, '下京区', 'other',      2),
  (35, 'tofukuji',             '東福寺',             34.9764, 135.7738, '東山区', 'history',    2),
  (36, 'pontocho',             '先斗町',             35.0066, 135.7708, '中京区', 'gourmet',    3),
  (37, 'demachi-futaba',       '出町ふたば',         35.0301, 135.7701, '上京区', 'gourmet',    2),
  (38, 'umekoji-park',         '梅小路公園',         34.9870, 135.7437, '下京区', 'nature',     1),
  (39, 'kyocera-museum',       '京都市京セラ美術館', 35.0140, 135.7830, '左京区', 'other',      1),
  (40, 'shogunzuka',           '将軍塚青龍殿',       35.0012, 135.7935, '山科区', 'photogenic', 2);

-- スポット本体（ID は md5('spot:' || ローマ字) から作る）
insert into public.spots (id, name, location, address, prefecture, city, category, source, created_by)
select
  md5('spot:' || s.romaji)::uuid,
  s.name,
  ST_SetSRID(ST_MakePoint(s.lng, s.lat), 4326)::geography,
  '京都府京都市' || s.ward,
  '京都府',
  '京都市',
  s.category,
  'search_db',
  '11111111-1111-4111-8111-111111111111'
from seed_spots s
on conflict (id) do nothing;

-- ---------- 投稿（カテゴリごとの定型コメントを 1〜3 件） ----------
create temp table seed_comments (
  category text,
  idx int,
  comment text,
  stay_duration text
) on commit drop;

insert into seed_comments (category, idx, comment, stay_duration) values
  ('history',    1, '朝早く行くと人が少なく、静かに境内を歩けました。',             'lt60'),
  ('history',    2, '拝観料はかかりますが、庭園まで見る価値があります。',           'lt120'),
  ('history',    3, '夕方の光が建物に当たる時間帯がきれいでした。',                 'lt60'),
  ('nature',     1, '木陰が多く、夏でも歩きやすい道でした。',                       'lt60'),
  ('nature',     2, '新緑の季節は緑がとても濃くておすすめです。',                   'lt60'),
  ('nature',     3, '川沿いでのんびり過ごせます。休日は家族連れが多めです。',       'lt30'),
  ('gourmet',    1, '食べ歩きができるお店が多く、少しずつ色々試せました。',         'lt60'),
  ('gourmet',    2, '昼の時間帯は行列になるので、少し早めがおすすめです。',         'lt30'),
  ('gourmet',    3, '夜は雰囲気が変わり、落ち着いて食事ができました。',             'lt120'),
  ('photogenic', 1, '夕暮れどきの写真が一番きれいに撮れました。',                   'lt30'),
  ('photogenic', 2, '午前中は逆光になりにくく、人も少なめでした。',                 'lt30'),
  ('photogenic', 3, '雨上がりは路面に景色が映り込んで良い雰囲気でした。',           'lt60'),
  ('other',      1, '展示が充実していて、半日ゆっくり楽しめました。',               'half_day'),
  ('other',      2, '屋内なので雨の日の予定にも組み込みやすいです。',               'lt120'),
  ('other',      3, '子ども連れでも回りやすく、休憩スペースも多めでした。',         'lt120');

-- 投稿本体（ID は md5('post:' || ローマ字 || 番号)）。投稿時刻は時間帯分布がばらけるようにずらす
insert into public.posts (id, user_id, spot_id, comment, category, stay_duration, status, created_at, updated_at)
select
  md5('post:' || s.romaji || ':' || n)::uuid,
  '11111111-1111-4111-8111-111111111111',
  md5('spot:' || s.romaji)::uuid,
  c.comment,
  s.category,
  c.stay_duration,
  'public',
  timestamptz '2026-09-01 08:00:00+09' + ((s.ord * 7 + n * 11) % 97) * interval '5 hours 17 minutes',
  timestamptz '2026-09-01 08:00:00+09' + ((s.ord * 7 + n * 11) % 97) * interval '5 hours 17 minutes'
from seed_spots s
cross join generate_series(1, s.n_posts) as n
join seed_comments c on c.category = s.category and c.idx = n
on conflict (id) do nothing;

-- 投稿ごとに写真 1 枚（本画像 1600x1200、サムネイル 400x300）
insert into public.post_images (id, post_id, full_path, thumb_path, width, height, sort_order)
select
  md5('img:' || s.romaji || ':' || n)::uuid,
  md5('post:' || s.romaji || ':' || n)::uuid,
  'seed/' || s.romaji || '/' || n || '.webp',
  'seed/' || s.romaji || '/' || n || '_t.webp',
  1600,
  1200,
  0
from seed_spots s
cross join generate_series(1, s.n_posts) as n
on conflict (id) do nothing;

-- ---------- 統計の再計算（投稿数・代表写真・時間帯分布など） ----------
do $$
declare
  r record;
begin
  for r in select id from public.spots loop
    perform public.recompute_spot_stats(r.id);
  end loop;
end;
$$;

commit;
