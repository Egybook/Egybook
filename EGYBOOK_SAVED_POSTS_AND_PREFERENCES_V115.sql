-- EgyBook v115: cloud saved posts + account preferences.
-- Run once in Supabase SQL Editor. Saved posts reference the original post;
-- media is NOT copied to R2 when a post is saved.
begin;

create table if not exists public.saved_posts (
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id text not null,
  saved_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index if not exists saved_posts_user_saved_at_idx
  on public.saved_posts(user_id, saved_at desc);
alter table public.saved_posts enable row level security;
drop policy if exists "Users read own saved posts" on public.saved_posts;
create policy "Users read own saved posts" on public.saved_posts
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users save own posts" on public.saved_posts;
create policy "Users save own posts" on public.saved_posts
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users remove own saved posts" on public.saved_posts;
create policy "Users remove own saved posts" on public.saved_posts
  for delete to authenticated using (auth.uid() = user_id);
grant select, insert, delete on public.saved_posts to authenticated;

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.user_preferences enable row level security;
drop policy if exists "Users read own preferences" on public.user_preferences;
create policy "Users read own preferences" on public.user_preferences
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users insert own preferences" on public.user_preferences;
create policy "Users insert own preferences" on public.user_preferences
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users update own preferences" on public.user_preferences;
create policy "Users update own preferences" on public.user_preferences
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update on public.user_preferences to authenticated;

commit;
