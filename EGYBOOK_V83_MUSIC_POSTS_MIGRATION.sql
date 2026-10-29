-- EgyBook v83: persistent music-on-image posts and multi-image media
-- Run in Supabase SQL Editor before publishing music-backed posts.
alter table public.posts add column if not exists media_urls jsonb not null default '[]'::jsonb;
alter table public.posts add column if not exists music_track_id text;
alter table public.posts add column if not exists music_permalink text;
alter table public.posts add column if not exists music_artwork_url text;
alter table public.posts add column if not exists music_start_seconds integer not null default 0;
alter table public.posts add column if not exists music_duration_seconds integer not null default 30;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'posts_music_duration_seconds_range') then
    alter table public.posts add constraint posts_music_duration_seconds_range check (music_duration_seconds between 5 and 30) not valid;
  end if;
end $$;
alter table public.posts validate constraint posts_music_duration_seconds_range;
