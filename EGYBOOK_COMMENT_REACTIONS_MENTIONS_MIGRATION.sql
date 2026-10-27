-- EgyBook: durable reactions on comments and replies + mention-friendly comments
-- Additive migration: preserves all existing comments and replies.
begin;
create table if not exists public.post_comment_reactions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.post_comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null check (reaction in ('👍','👎','❤️','😍','😂','😮','😢','😡')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (comment_id, user_id)
);
create index if not exists post_comment_reactions_comment_idx on public.post_comment_reactions(comment_id, created_at desc);
alter table public.post_comment_reactions enable row level security;
grant select on public.post_comment_reactions to anon, authenticated;
grant insert, update, delete on public.post_comment_reactions to authenticated;
drop policy if exists "Comment reactions are publicly readable" on public.post_comment_reactions;
create policy "Comment reactions are publicly readable" on public.post_comment_reactions for select to anon, authenticated using (true);
drop policy if exists "Users add own comment reactions" on public.post_comment_reactions;
create policy "Users add own comment reactions" on public.post_comment_reactions for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users update own comment reactions" on public.post_comment_reactions;
create policy "Users update own comment reactions" on public.post_comment_reactions for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users delete own comment reactions" on public.post_comment_reactions;
create policy "Users delete own comment reactions" on public.post_comment_reactions for delete to authenticated using (auth.uid() = user_id);
notify pgrst, 'reload schema';
commit;
