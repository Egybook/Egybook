-- EgyBook account isolation migration
-- Safe additive migration: does not delete existing users, profiles, posts, or media.

alter table public.profiles
  add column if not exists location text not null default '';

create table if not exists public.profile_private (
  user_id uuid primary key references auth.users(id) on delete cascade,
  phone text not null default '',
  birthdate date,
  gender text not null default '',
  website text not null default '',
  privacy text not null default 'عام' check (privacy in ('عام','الأصدقاء','أنا فقط')),
  updated_at timestamptz not null default now()
);

alter table public.profile_private enable row level security;
grant select, insert, update, delete on public.profile_private to authenticated;

drop policy if exists "Users read own private profile" on public.profile_private;
create policy "Users read own private profile" on public.profile_private
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Users insert own private profile" on public.profile_private;
create policy "Users insert own private profile" on public.profile_private
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "Users update own private profile" on public.profile_private;
create policy "Users update own private profile" on public.profile_private
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users delete own private profile" on public.profile_private;
create policy "Users delete own private profile" on public.profile_private
  for delete to authenticated using (auth.uid() = user_id);
