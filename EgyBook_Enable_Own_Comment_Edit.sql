-- EgyBook: enable owners to edit their own comments
-- Run this in Supabase SQL Editor.
-- Assumption to verify: public.post_comments.user_id stores auth.users.id (UUID).
-- This migration does NOT change existing comments, replies, likes, or other tables.

begin;

do $$
begin
  if to_regclass('public.post_comments') is null then
    raise exception 'Table public.post_comments was not found. No changes were applied.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'post_comments'
      and column_name = 'user_id'
  ) then
    raise exception 'Column public.post_comments.user_id was not found. No changes were applied. Check the actual comment-owner column before running this migration.';
  end if;
end
$$;

alter table public.post_comments enable row level security;

grant update on table public.post_comments to authenticated;

drop policy if exists "post_comments_update_own" on public.post_comments;

create policy "post_comments_update_own"
on public.post_comments
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

commit;
