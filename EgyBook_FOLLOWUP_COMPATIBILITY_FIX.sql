-- EgyBook follow-up compatibility patch
-- Run in Supabase SQL Editor AFTER the previous migration.
-- Fixes UUID-vs-text comparison in the comment notification trigger.
create or replace function public.egybook_notify_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
begin
  select p.user_id into owner_id
  from public.posts p
  where p.id::text = new.post_id::text
  limit 1;

  if owner_id is not null and owner_id <> new.user_id then
    insert into public.notifications
      (recipient_id, actor_id, type, title, body, post_id, comment_id)
    values
      (owner_id, new.user_id, 'comment', 'تعليق جديد',
       'علّق على منشورك: ' || left(coalesce(new.body, ''), 120),
       nullif(new.post_id::text, '')::uuid, new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists egybook_comment_notification on public.post_comments;
create trigger egybook_comment_notification
after insert on public.post_comments
for each row execute function public.egybook_notify_comment();

-- The table may have existed before the previous migration with a different column set.
alter table public.verification_requests
  add column if not exists message text not null default 'طلب توثيق حساب EgyBook';
alter table public.verification_requests
  add column if not exists status text not null default 'pending';
alter table public.verification_requests
  add column if not exists reviewed_at timestamptz;
alter table public.verification_requests
  add column if not exists created_at timestamptz not null default now();

alter table public.verification_requests enable row level security;
grant select, insert on public.verification_requests to authenticated;

drop policy if exists "Users create own verification request" on public.verification_requests;
create policy "Users create own verification request"
on public.verification_requests for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users read own verification requests" on public.verification_requests;
create policy "Users read own verification requests"
on public.verification_requests for select to authenticated
using (auth.uid() = user_id);
