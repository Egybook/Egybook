-- EgyBook: remove legacy Supabase Storage media references after switching to R2
-- Review the counts first. This script clears media references only; it does NOT
-- delete posts, comments, profiles, authentication records, or Storage objects.
-- Run in Supabase SQL Editor after deploying the R2-only site.

begin;

-- Post media references. Preserve text, reactions, comments, and post records.
update public.posts
set media_url = null,
    media_type = null,
    media_urls = '[]'::jsonb,
    updated_at = now()
where (media_url is not null or media_type is not null or media_urls <> '[]'::jsonb)
  and coalesce(btrim(text), '') <> '';

-- Comment image/audio attachments.
update public.post_comments
set image_url = null, audio_url = null
where image_url is not null or audio_url is not null;

-- Profile images.
update public.profiles
set avatar_url = null, cover_url = null
where avatar_url is not null or cover_url is not null;

commit;

-- NOTE: media-only posts with empty text are intentionally not modified because
-- the posts_text_or_media constraint may reject clearing their final media field.
-- Review and remove those test posts separately if desired.
-- After confirming the site no longer uses Supabase Storage, delete the old
-- bucket from Supabase Dashboard > Storage. Do not delete storage.objects rows
-- directly with SQL; use the Storage UI/API so the underlying objects are removed.
