-- EgyBook: repair post/photo reactions and comments schema
-- Additive only: does not delete existing users, posts, comments, or reactions.
begin;

create table if not exists public.post_reactions (
  id uuid primary key default gen_random_uuid(),
  post_id text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null check (reaction in ('👍','❤️','😮','😂','😢','😡')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (post_id, user_id)
);
create index if not exists post_reactions_post_id_idx on public.post_reactions(post_id);
alter table public.post_reactions enable row level security;
grant select on public.post_reactions to anon, authenticated;
grant insert, update, delete on public.post_reactions to authenticated;
drop policy if exists "Post reactions are publicly readable" on public.post_reactions;
create policy "Post reactions are publicly readable" on public.post_reactions for select to anon, authenticated using (true);
drop policy if exists "Users add own post reactions" on public.post_reactions;
create policy "Users add own post reactions" on public.post_reactions for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users update own post reactions" on public.post_reactions;
create policy "Users update own post reactions" on public.post_reactions for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users delete own post reactions" on public.post_reactions;
create policy "Users delete own post reactions" on public.post_reactions for delete to authenticated using (auth.uid() = user_id);

create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  user_name text not null default 'عضو EgyBook',
  body text not null check (length(trim(body)) between 1 and 5000),
  parent_id uuid references public.post_comments(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists post_comments_post_created_idx on public.post_comments(post_id, created_at);
alter table public.post_comments enable row level security;
grant select on public.post_comments to anon, authenticated;
grant insert, delete on public.post_comments to authenticated;
drop policy if exists "Post comments are publicly readable" on public.post_comments;
create policy "Post comments are publicly readable" on public.post_comments for select to anon, authenticated using (true);
drop policy if exists "Users add own post comments" on public.post_comments;
create policy "Users add own post comments" on public.post_comments for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users delete own post comments" on public.post_comments;
create policy "Users delete own post comments" on public.post_comments for delete to authenticated using (auth.uid() = user_id);

-- Reactions and comments for standalone photos (profile avatar/cover and album photos).
-- post_id-based tables above handle photos attached to a post; these tables cover photo-only URLs.
create table if not exists public.photo_reactions (
  id uuid primary key default gen_random_uuid(),
  photo_id text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null check (reaction in ('👍','❤️','😮','😂','😢','😡')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (photo_id, user_id)
);
create index if not exists photo_reactions_photo_id_idx on public.photo_reactions(photo_id);
alter table public.photo_reactions enable row level security;
grant select on public.photo_reactions to anon, authenticated;
grant insert, update, delete on public.photo_reactions to authenticated;
drop policy if exists "Photo reactions are publicly readable" on public.photo_reactions;
create policy "Photo reactions are publicly readable" on public.photo_reactions for select to anon, authenticated using (true);
drop policy if exists "Users add own photo reactions" on public.photo_reactions;
create policy "Users add own photo reactions" on public.photo_reactions for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users update own photo reactions" on public.photo_reactions;
create policy "Users update own photo reactions" on public.photo_reactions for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users delete own photo reactions" on public.photo_reactions;
create policy "Users delete own photo reactions" on public.photo_reactions for delete to authenticated using (auth.uid() = user_id);

create table if not exists public.photo_comments (
  id uuid primary key default gen_random_uuid(),
  photo_id text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  user_name text not null default 'عضو EgyBook',
  body text not null check (length(trim(body)) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index if not exists photo_comments_photo_created_idx on public.photo_comments(photo_id, created_at);
alter table public.photo_comments enable row level security;
grant select on public.photo_comments to anon, authenticated;
grant insert, delete on public.photo_comments to authenticated;
drop policy if exists "Photo comments are publicly readable" on public.photo_comments;
create policy "Photo comments are publicly readable" on public.photo_comments for select to anon, authenticated using (true);
drop policy if exists "Users add own photo comments" on public.photo_comments;
create policy "Users add own photo comments" on public.photo_comments for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users delete own photo comments" on public.photo_comments;
create policy "Users delete own photo comments" on public.photo_comments for delete to authenticated using (auth.uid() = user_id);

-- Ask PostgREST/Supabase API to refresh its schema cache.
notify pgrst, 'reload schema';

commit;
