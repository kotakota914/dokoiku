-- =============================================================================
-- Storage（要件定義書 10.4）
-- バケット post-images は公開読み取り。アップロード（署名付き URL の発行）と
-- 一時パスからの移動はサーバーの service role が行うため、書き込みの policy は作らない。
-- ローカル検証では storage スキーマのスタブに対して流す（省略も可）。
-- =============================================================================

-- 写真用の公開バケット。変換後 1 枚 2MB 以内・WebP / JPEG のみ（9.3 POST /uploads、ADR-0019）。
-- 署名付き URL への PUT にもバケットの制限が効くため、EXIF 付きの元画像や非画像を置けない（api-02）
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-images', 'post-images', true, 2097152, array['image/webp', 'image/jpeg'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 写真は全員が読める（select のみ）
drop policy if exists "post images are publicly readable" on storage.objects;
create policy "post images are publicly readable"
  on storage.objects for select
  using (bucket_id = 'post-images');
