-- EgyBook Hossam update: allow browser-recorded audio comment attachments.
-- Preserve any custom MIME types already configured for post-media.
-- Existing folder-scoped storage policies remain in force.
begin;

update storage.buckets as b
set allowed_mime_types = (
  select array_agg(distinct mime order by mime)
  from unnest(
    coalesce(b.allowed_mime_types, array[]::text[]) ||
    array[
      'audio/webm','audio/ogg','audio/opus','audio/mp4','audio/aac',
      'audio/mpeg','audio/wav','audio/x-wav','audio/3gpp','audio/amr',
      'audio/x-m4a'
    ]::text[]
  ) as types(mime)
)
where b.id = 'post-media';

commit;
