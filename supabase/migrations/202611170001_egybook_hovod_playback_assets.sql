-- EgyBook + Hovod: trusted playback-to-post mapping.
-- Additive only. Does not modify existing posts or media records.
create table if not exists public.hovod_playback_assets (
  playback_id text primary key,
  post_id uuid not null references public.posts(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  processing_status text not null default 'processing'
    check (processing_status in ('processing','ready','failed','deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hovod_playback_assets_id_format check (playback_id ~ '^[A-Za-z0-9_-]{8,128}$')
);
create index if not exists hovod_playback_assets_post_id_idx
  on public.hovod_playback_assets(post_id);
create index if not exists hovod_playback_assets_owner_id_idx
  on public.hovod_playback_assets(owner_id);

alter table public.hovod_playback_assets enable row level security;
-- Deliberately no anon/authenticated policies and no client grants.
revoke all on public.hovod_playback_assets from anon, authenticated;
grant select, insert, update, delete on public.hovod_playback_assets to service_role;

comment on table public.hovod_playback_assets is
  'Server-only mapping from Hovod playback IDs to EgyBook posts; used by the authorization Edge Function.';
