-- EgyBook: durable notifications + verification requests
-- Run this file in Supabase SQL Editor after backing up the project.
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
create index if not exists notifications_recipient_created_idx on public.notifications(recipient_id, created_at desc);
alter table public.notifications enable row level security;
grant select, update on public.notifications to authenticated;
drop policy if exists "Users read own notifications" on public.notifications;
create policy "Users read own notifications" on public.notifications for select to authenticated using (auth.uid() = recipient_id);
drop policy if exists "Users mark own notifications read" on public.notifications;
create policy "Users mark own notifications read" on public.notifications for update to authenticated using (auth.uid() = recipient_id) with check (auth.uid() = recipient_id);

create or replace function public.egybook_notify_friend_request() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='pending' then
    insert into public.notifications(recipient_id,actor_id,type,title,body,friend_request_id)
    values(new.receiver_id,new.sender_id,'friend_request','طلب صداقة','أرسل لك طلب صداقة',new.id);
  end if;
  return new;
end; $$;
drop trigger if exists egybook_friend_request_notification on public.friend_requests;
create trigger egybook_friend_request_notification after insert on public.friend_requests
for each row execute function public.egybook_notify_friend_request();

create or replace function public.egybook_notify_reaction() returns trigger language plpgsql security definer set search_path=public as $$
declare owner_id uuid;
begin
  select user_id into owner_id from public.posts where id=new.post_id;
  if owner_id is not null and owner_id <> new.user_id then
    insert into public.notifications(recipient_id,actor_id,type,title,body,post_id)
    values(owner_id,new.user_id,'reaction','تفاعل جديد','تفاعل مع منشورك '||coalesce(new.reaction,'👍'),new.post_id);
  end if;
  return new;
end; $$;
drop trigger if exists egybook_reaction_notification on public.post_reactions;
create trigger egybook_reaction_notification after insert on public.post_reactions
for each row execute function public.egybook_notify_reaction();

create or replace function public.egybook_notify_comment() returns trigger language plpgsql security definer set search_path=public as $$
declare owner_id uuid;
begin
  select user_id into owner_id from public.posts where id=new.post_id;
  if owner_id is not null and owner_id <> new.user_id then
    insert into public.notifications(recipient_id,actor_id,type,title,body,post_id,comment_id)
    values(owner_id,new.user_id,'comment','تعليق جديد','علّق على منشورك: '||left(coalesce(new.body,''),120),new.post_id,new.id);
  end if;
  return new;
end; $$;
drop trigger if exists egybook_comment_notification on public.post_comments;
create trigger egybook_comment_notification after insert on public.post_comments
for each row execute function public.egybook_notify_comment();

create table if not exists public.verification_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  message text not null default '',
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique(user_id,status) deferrable initially immediate
);
alter table public.verification_requests enable row level security;
grant select, insert on public.verification_requests to authenticated;
drop policy if exists "Users create own verification request" on public.verification_requests;
create policy "Users create own verification request" on public.verification_requests for insert to authenticated with check(auth.uid()=user_id);
drop policy if exists "Users read own verification requests" on public.verification_requests;
create policy "Users read own verification requests" on public.verification_requests for select to authenticated using(auth.uid()=user_id);
