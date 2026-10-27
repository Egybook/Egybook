-- EgyBook friend presence privacy + profile detail compatibility
-- Safe to run more than once in Supabase SQL Editor.
alter table public.profiles
  add column if not exists activity_privacy text not null default 'friends';

alter table public.profiles
  drop constraint if exists profiles_activity_privacy_check;
alter table public.profiles
  add constraint profiles_activity_privacy_check
  check (activity_privacy in ('friends','hidden','private','public'));

create index if not exists friend_requests_accepted_sender_receiver_idx
  on public.friend_requests (sender_id, receiver_id, status);

-- Presence uses the existing last_seen_at field from
-- EGYBOOK_FRIEND_PRESENCE_MIGRATION.sql. This migration does not weaken RLS.
