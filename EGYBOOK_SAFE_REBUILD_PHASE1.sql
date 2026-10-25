-- EgyBook Safe Rebuild — Phase 1
-- Keeps auth.users, public.profiles, profile_private, user_roles, verified_accounts,
-- verification_requests, verification_settings, and all Storage objects untouched.
-- Deletes only social/demo content rows and normalizes post_id to UUID.
-- Run in Supabase SQL Editor after taking a database backup.
-- Transactional: any error rolls back the entire migration.

begin;

do $preflight$
begin
  if to_regclass('auth.users') is null then
    raise exception 'Preflight failed: auth.users is missing.';
  end if;
  if to_regclass('public.profiles') is null then
    raise exception 'Preflight failed: public.profiles is missing.';
  end if;
  if to_regclass('public.posts') is null then
    raise exception 'Preflight failed: public.posts is missing.';
  end if;
  if to_regclass('public.post_reactions') is null then
    raise exception 'Preflight failed: public.post_reactions is missing. Run the project setup migrations first.';
  end if;
  if to_regclass('public.post_comments') is null then
    raise exception 'Preflight failed: public.post_comments is missing. Run the project setup migrations first.';
  end if;
end
$preflight$;

-- 1) Remove only demo/social rows. Keep account/profile and verification records.
-- Delete dependents first; do not delete auth.users or profiles.
do $cleanup$
declare t text;
begin
  foreach t in array array[
    'notifications',
    'comment_reactions',
    'post_reactions',
    'post_comments',
    'photo_reactions',
    'photo_comments',
    'friend_requests',
    'user_follows',
    'post_media',
    'album_photos',
    'photo_albums',
    'stories',
    'reels',
    'posts'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('delete from public.%I', t);
    end if;
  end loop;
end
$cleanup$;

-- 2) Standardize post foreign keys to UUID now that experimental content rows are cleared.
-- Existing frontend sends UUID strings; PostgREST/Postgres accepts those in UUID columns.
alter table public.post_reactions
  alter column post_id type uuid using nullif(trim(post_id::text), '')::uuid;
alter table public.post_comments
  alter column post_id type uuid using nullif(trim(post_id::text), '')::uuid;

-- Ensure these columns cannot be null.
alter table public.post_reactions alter column post_id set not null;
alter table public.post_comments alter column post_id set not null;

-- 3) Add foreign keys idempotently (avoids duplicate constraints on reruns).
do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.post_reactions'::regclass
      and conname='post_reactions_post_id_fkey'
  ) then
    alter table public.post_reactions
      add constraint post_reactions_post_id_fkey
      foreign key (post_id) references public.posts(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.post_comments'::regclass
      and conname='post_comments_post_id_fkey'
  ) then
    alter table public.post_comments
      add constraint post_comments_post_id_fkey
      foreign key (post_id) references public.posts(id) on delete cascade;
  end if;
end
$constraints$;

-- 4) Indexes used by feed/interactions.
create index if not exists posts_created_at_idx on public.posts (created_at desc);
create index if not exists posts_user_id_idx on public.posts (user_id);
create index if not exists post_reactions_post_id_idx on public.post_reactions (post_id);
create index if not exists post_comments_post_created_idx on public.post_comments (post_id, created_at);
create index if not exists notifications_recipient_created_idx on public.notifications (recipient_id, created_at desc);

-- 5) Fix notification triggers using UUID-to-UUID comparison.
create or replace function public.egybook_notify_reaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare owner_id uuid;
begin
  select p.user_id into owner_id
  from public.posts p
  where p.id = new.post_id
  limit 1;

  if owner_id is not null and owner_id <> new.user_id then
    insert into public.notifications
      (recipient_id, actor_id, type, title, body, post_id)
    values
      (owner_id, new.user_id, 'reaction', 'تفاعل جديد',
       'تفاعل مع منشورك ' || coalesce(new.reaction, '👍'),
       new.post_id);
  end if;
  return new;
end;
$$;

create or replace function public.egybook_notify_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare owner_id uuid;
begin
  select p.user_id into owner_id
  from public.posts p
  where p.id = new.post_id
  limit 1;

  if owner_id is not null and owner_id <> new.user_id then
    insert into public.notifications
      (recipient_id, actor_id, type, title, body, post_id, comment_id)
    values
      (owner_id, new.user_id, 'comment', 'تعليق جديد',
       'علّق على منشورك: ' || left(coalesce(new.body, ''), 120),
       new.post_id, new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists egybook_reaction_notification on public.post_reactions;
create trigger egybook_reaction_notification
after insert on public.post_reactions
for each row execute function public.egybook_notify_reaction();

drop trigger if exists egybook_comment_notification on public.post_comments;
create trigger egybook_comment_notification
after insert on public.post_comments
for each row execute function public.egybook_notify_comment();

-- 6) Refresh API schema cache.
notify pgrst, 'reload schema';

commit;
