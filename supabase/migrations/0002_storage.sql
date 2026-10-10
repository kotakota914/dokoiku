-- =============================================================================
-- Storage（要件定義書 10.4）
-- バケット post-images は公開読み取り。アップロード（署名付き URL の発行）と
-- 一時パスからの移動はサーバーの service role が行うため、書き込みの policy は作らない。
-- ローカル検証では storage スキーマのスタブに対して流す（省略も可）。
-- =============================================================================

-- 写真用の公開バケット
insert into storage.buckets (id, name, public)
values ('post-images', 'post-images', true)
on conflict (id) do nothing;

-- 写真は全員が読める（select のみ）
drop policy if exists "post images are publicly readable" on storage.objects;
create policy "post images are publicly readable"
  on storage.objects for select
  using (bucket_id = 'post-images');
