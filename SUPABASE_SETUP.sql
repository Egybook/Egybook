-- EgyBook Supabase setup
-- Run this in Supabase Dashboard > SQL Editor. Existing public.profiles table is preserved.
create extension if not exists pgcrypto;

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null default '',
  media_url text,
  media_type text check (media_type is null or media_type in ('image','video')),
  visibility text not null default 'الجميع' check (visibility in ('الجميع','الأصدقاء','أنا فقط')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint posts_text_or_media check (length(trim(text)) > 0 or media_url is not null)
);
create index if not exists posts_created_at_idx on public.posts (created_at desc);
create index if not exists posts_user_id_idx on public.posts (user_id);
-- SQL privileges are required in addition to RLS policies.
grant select on public.posts to anon;
grant select, insert, update, delete on public.posts to authenticated;
alter table public.posts enable row level security;
drop policy if exists "Posts readable by everyone" on public.posts;
create policy "Posts readable by everyone" on public.posts for select to anon, authenticated using (visibility = 'الجميع' or auth.uid() = user_id);
drop policy if exists "Users create own posts" on public.posts;
create policy "Users create own posts" on public.posts for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users update own posts" on public.posts;
create policy "Users update own posts" on public.posts for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users delete own posts" on public.posts;
create policy "Users delete own posts" on public.posts for delete to authenticated using (auth.uid() = user_id);

-- Cloud profile images: avatar_url and cover_url store public Storage URLs.
alter table public.profiles add column if not exists cover_url text;
-- Ensure the application roles have table privileges; RLS still restricts which rows can be changed.
grant select on public.profiles to anon;
grant select, insert, update on public.profiles to authenticated;

-- Profile policies (safe to recreate; table already exists)
alter table public.profiles enable row level security;
drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile" on public.profiles for insert to authenticated with check (auth.uid() = id);
drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists "Profiles are readable by everyone" on public.profiles;
create policy "Profiles are readable by everyone" on public.profiles for select to anon, authenticated using (true);

-- Public media URLs are used for post images/videos; only signed-in users can upload to their own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-media','post-media',true,52428800,array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime'])
on conflict (id) do update set public = true, file_size_limit = 52428800, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "Post media is publicly readable" on storage.objects;
create policy "Post media is publicly readable" on storage.objects for select to anon, authenticated using (bucket_id = 'post-media');
drop policy if exists "Users upload own post media" on storage.objects;
create policy "Users upload own post media" on storage.objects for insert to authenticated with check (bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users update own post media" on storage.objects;
create policy "Users update own post media" on storage.objects for update to authenticated using (bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text) with check (bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users delete own post media" on storage.objects;
create policy "Users delete own post media" on storage.objects for delete to authenticated using (bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- Explicit policies for avatar/cover files stored under <auth.uid()>/profile/.
-- These are scoped to the signed-in user's own folder; they do not allow cross-user uploads.
drop policy if exists "Users upload own profile images" on storage.objects;
create policy "Users upload own profile images" on storage.objects for insert to authenticated
  with check (bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text and (storage.foldername(name))[2] = 'profile');
drop policy if exists "Users update own profile images" on storage.objects;
create policy "Users update own profile images" on storage.objects for update to authenticated
  using (bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text and (storage.foldername(name))[2] = 'profile')
  with check (bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text and (storage.foldername(name))[2] = 'profile');
drop policy if exists "Users delete own profile images" on storage.objects;
create policy "Users delete own profile images" on storage.objects for delete to authenticated
  using (bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text and (storage.foldername(name))[2] = 'profile');

-- EgyBook owner/admin roles and verification request foundation.
-- IMPORTANT: never allow users to assign their own role or verification status.
create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','moderator')),
  created_at timestamptz not null default now()
);
alter table public.user_roles enable row level security;
drop policy if exists "Users can read their own role" on public.user_roles;
create policy "Users can read their own role" on public.user_roles for select to authenticated using (auth.uid() = user_id);

create or replace function public.is_site_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.user_roles r where r.user_id = auth.uid() and r.role in ('owner','admin')); $$;
revoke all on function public.is_site_admin() from public;
grant execute on function public.is_site_admin() to authenticated;

create table if not exists public.verification_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan text not null check (plan in ('free','paid')),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  display_name text not null,
  profile_url text,
  reason text,
  payment_status text not null default 'not_required' check (payment_status in ('not_required','pending','paid','failed','refunded')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id)
);
create index if not exists verification_requests_user_created_idx on public.verification_requests(user_id, created_at desc);
create index if not exists verification_requests_status_idx on public.verification_requests(status, created_at desc);
alter table public.verification_requests enable row level security;
drop policy if exists "Users can view own verification requests" on public.verification_requests;
create policy "Users can view own verification requests" on public.verification_requests for select to authenticated using (auth.uid() = user_id or public.is_site_admin());
drop policy if exists "Users can submit own verification requests" on public.verification_requests;
create policy "Users can submit own verification requests" on public.verification_requests for insert to authenticated with check (auth.uid() = user_id and status = 'pending' and reviewed_at is null and reviewed_by is null and payment_status in ('not_required','pending'));
drop policy if exists "Admins review verification requests" on public.verification_requests;
create policy "Admins review verification requests" on public.verification_requests for update to authenticated using (public.is_site_admin()) with check (public.is_site_admin());

-- Verification status is separate from profiles so users cannot grant themselves a badge.
create table if not exists public.verified_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  verified_by uuid references auth.users(id),
  verification_type text not null check (verification_type in ('owner','free','paid')),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- Set the site's owner account and permanent verified badge.
-- This uses the owner's Auth UID supplied for EgyBook; rerunning is safe.
insert into public.user_roles (user_id, role)
values ('83cbb858-a62f-469a-9723-2919ead6bc58'::uuid, 'owner')
on conflict (user_id) do update set role = 'owner';

insert into public.verified_accounts (user_id, verified_by, verification_type, expires_at)
values (
  '83cbb858-a62f-469a-9723-2919ead6bc58'::uuid,
  '83cbb858-a62f-469a-9723-2919ead6bc58'::uuid,
  'owner',
  null
)
on conflict (user_id) do update
set verified_by = excluded.verified_by,
    verification_type = 'owner',
    expires_at = null;

alter table public.verified_accounts enable row level security;
-- Table privileges are required in addition to RLS for the app to read verification badges.
grant select on public.verified_accounts to anon, authenticated;
drop policy if exists "Verified badges are publicly readable" on public.verified_accounts;
create policy "Verified badges are publicly readable" on public.verified_accounts for select to anon, authenticated using (expires_at is null or expires_at > now());
drop policy if exists "Admins manage verified accounts" on public.verified_accounts;
create policy "Admins manage verified accounts" on public.verified_accounts for all to authenticated using (public.is_site_admin()) with check (public.is_site_admin());

create table if not exists public.verification_settings (
  id integer primary key default 1 check (id = 1),
  paid_enabled boolean not null default false,
  monthly_price_egp numeric(10,2) not null default 0 check (monthly_price_egp >= 0),
  yearly_price_egp numeric(10,2) not null default 0 check (yearly_price_egp >= 0),
  duration_days integer not null default 30 check (duration_days between 1 and 3650),
  updated_at timestamptz not null default now()
);
insert into public.verification_settings (id) values (1) on conflict (id) do nothing;
alter table public.verification_settings enable row level security;
drop policy if exists "Verification settings readable" on public.verification_settings;
create policy "Verification settings readable" on public.verification_settings for select to anon, authenticated using (true);
drop policy if exists "Admins update verification settings" on public.verification_settings;
create policy "Admins update verification settings" on public.verification_settings for update to authenticated using (public.is_site_admin()) with check (public.is_site_admin());

-- Owner bootstrap is intentionally manual after signup: use the new account's Auth UID.
-- Replace the UUID below with the actual UID shown in Authentication > Users, then run only this insert.
-- insert into public.user_roles (user_id, role) values ('PASTE_OWNER_AUTH_UID_HERE'::uuid, 'owner') on conflict (user_id) do update set role = 'owner';
-- Add the owner's permanent verified badge after assigning the owner role:
-- insert into public.verified_accounts (user_id, verified_by, verification_type) values ('PASTE_OWNER_AUTH_UID_HERE'::uuid, 'PASTE_OWNER_AUTH_UID_HERE'::uuid, 'owner') on conflict (user_id) do update set verification_type = 'owner', expires_at = null;


-- Unified photo viewer: cloud-backed post reactions and comments.
-- Run this section in Supabase SQL Editor after reviewing it.
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
