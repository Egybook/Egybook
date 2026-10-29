-- EgyBook v97: normalize the post_comments body constraint without deleting existing data.
-- This migration intentionally leaves existing rows unvalidated; new inserts/updates are checked.
begin;

alter table public.post_comments
  add column if not exists image_url text;

alter table public.post_comments
  add column if not exists audio_url text;

alter table public.post_comments
  add column if not exists audio_duration_seconds integer not null default 0;

alter table public.post_comments
  drop constraint if exists post_comments_body_check;

alter table public.post_comments
  add constraint post_comments_body_check
  check (
    (
      char_length(btrim(coalesce(body, ''))) between 1 and 5000
    )
    or
    (
      nullif(btrim(coalesce(image_url, '')), '') is not null
      or nullif(btrim(coalesce(audio_url, '')), '') is not null
    )
  ) not valid;

commit;

notify pgrst, 'reload schema';
