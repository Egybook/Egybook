-- EgyBook composer metadata migration v81
-- Review this migration before running it in Supabase.
alter table public.posts
  add column if not exists feeling text,
  add column if not exists activity text,
  add column if not exists location_name text,
  add column if not exists tagged_user_ids uuid[] not null default '{}',
  add column if not exists music_title text,
  add column if not exists music_artist text;
