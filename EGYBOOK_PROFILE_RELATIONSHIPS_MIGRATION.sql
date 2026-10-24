-- Additive migration for EgyBook profile follow relationships.
-- Friend requests are managed by EGYBOOK_FRIEND_REQUESTS_MIGRATION.sql.
begin;

create table if not exists public.user_follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint user_follows_pk primary key (follower_id, following_id),
  constraint user_follows_no_self check (follower_id <> following_id)
);
create index if not exists user_follows_following_idx on public.user_follows(following_id);
create index if not exists user_follows_follower_idx on public.user_follows(follower_id);
alter table public.user_follows enable row level security;
grant select, insert, delete on public.user_follows to authenticated;
drop policy if exists "Users can read follow relationships" on public.user_follows;
create policy "Users can read follow relationships" on public.user_follows
  for select to authenticated using (auth.uid() = follower_id or auth.uid() = following_id);
drop policy if exists "Users can follow as themselves" on public.user_follows;
create policy "Users can follow as themselves" on public.user_follows
  for insert to authenticated with check (auth.uid() = follower_id and follower_id <> following_id);
drop policy if exists "Users can unfollow as themselves" on public.user_follows;
create policy "Users can unfollow as themselves" on public.user_follows
  for delete to authenticated using (auth.uid() = follower_id);

notify pgrst, 'reload schema';
commit;
