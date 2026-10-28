-- EgyBook: social notification reliability fix (additive/idempotent)
-- Run in Supabase SQL Editor after reviewing your current schema.
-- This migration does not change existing notification RLS policies.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  type text not null check (type in ('friend_request','reaction','comment','system')),
  title text not null default 'إشعار جديد',
  body text not null default '',
  post_id uuid references public.posts(id) on delete cascade,
  comment_id uuid,
  friend_request_id uuid,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_recipient_created_idx
  on public.notifications(recipient_id, created_at desc);
alter table public.notifications enable row level security;
grant select, update on public.notifications to authenticated;

-- Notify post owner on a new reaction and on an actual reaction change.
create or replace function public.egybook_notify_reaction()
returns trigger language plpgsql security definer set search_path=public as $$
declare owner_id uuid;
begin
  if TG_OP = 'UPDATE' and new.reaction is not distinct from old.reaction then
    return new;
  end if;
  select p.user_id into owner_id from public.posts p where p.id::text = new.post_id::text limit 1;
  if owner_id is not null and owner_id <> new.user_id then
    insert into public.notifications(recipient_id,actor_id,type,title,body,post_id)
    values(owner_id,new.user_id,'reaction','تفاعل جديد','تفاعل مع منشورك '||coalesce(new.reaction,'👍'),new.post_id::uuid);
  end if;
  return new;
end; $$;
drop trigger if exists egybook_reaction_notification on public.post_reactions;
create trigger egybook_reaction_notification
after insert or update of reaction on public.post_reactions
for each row execute function public.egybook_notify_reaction();

-- Notify post owner for comments and replies (both use the supported comment type).
create or replace function public.egybook_notify_comment()
returns trigger language plpgsql security definer set search_path=public as $$
declare owner_id uuid;
begin
  select p.user_id into owner_id from public.posts p where p.id::text = new.post_id::text limit 1;
  if owner_id is not null and owner_id <> new.user_id then
    insert into public.notifications(recipient_id,actor_id,type,title,body,post_id,comment_id)
    values(owner_id,new.user_id,'comment',
      case when new.parent_id is null then 'تعليق جديد' else 'رد جديد على تعليق' end,
      case when new.parent_id is null then 'علّق على منشورك: ' else 'رد على تعليق في منشورك: ' end || left(coalesce(new.body,''),120),
      new.post_id::uuid,new.id);
  end if;
  return new;
end; $$;
drop trigger if exists egybook_comment_notification on public.post_comments;
create trigger egybook_comment_notification
after insert on public.post_comments
for each row execute function public.egybook_notify_comment();

-- Ensure notifications changes can reach Supabase Realtime subscribers when available.
do $$
begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
exception when duplicate_object then null;
end; $$;

notify pgrst, 'reload schema';
