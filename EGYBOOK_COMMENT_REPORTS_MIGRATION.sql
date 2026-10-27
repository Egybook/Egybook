-- EgyBook: secure reports for comments and replies (additive; preserves content)
begin;
create table if not exists public.post_comment_reports (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.post_comments(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reported_user_id uuid references public.profiles(id) on delete set null,
  reason text not null default 'لم يحدد سبب' check (char_length(reason) <= 500),
  status text not null default 'pending' check (status in ('pending','reviewed','dismissed','actioned')),
  created_at timestamptz not null default now(),
  unique (comment_id, reporter_id)
);
create index if not exists post_comment_reports_status_idx on public.post_comment_reports(status, created_at desc);
alter table public.post_comment_reports enable row level security;
grant insert, select on public.post_comment_reports to authenticated;
drop policy if exists "Users submit their own comment reports" on public.post_comment_reports;
create policy "Users submit their own comment reports" on public.post_comment_reports
for insert to authenticated with check (auth.uid() = reporter_id);
drop policy if exists "Users read their own comment reports" on public.post_comment_reports;
create policy "Users read their own comment reports" on public.post_comment_reports
for select to authenticated using (auth.uid() = reporter_id);
commit;
notify pgrst, 'reload schema';
-- Allow the owner of a post to remove comments/replies on that post, while
-- ordinary users remain limited to deleting their own comments.
grant delete on public.post_comments to authenticated;
drop policy if exists "Post owners delete comments on their posts" on public.post_comments;
create policy "Post owners delete comments on their posts" on public.post_comments
for delete to authenticated using (
  exists (
    select 1 from public.posts p
    where p.id = post_comments.post_id
      and p.user_id = auth.uid()
  )
);
