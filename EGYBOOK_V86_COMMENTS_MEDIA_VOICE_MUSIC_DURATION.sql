-- EgyBook v86: image and voice attachments for post comments/replies; longer music clips
begin;

alter table public.post_comments add column if not exists image_url text;
alter table public.post_comments add column if not exists audio_url text;
alter table public.post_comments add column if not exists audio_duration_seconds integer not null default 0;

alter table public.posts drop constraint if exists posts_music_duration_seconds_range;
alter table public.posts add constraint posts_music_duration_seconds_range
  check (music_duration_seconds between 5 and 110) not valid;

-- Existing posts use valid defaults; validate after the new range is applied.
alter table public.posts validate constraint posts_music_duration_seconds_range;

commit;
notify pgrst, 'reload schema';
