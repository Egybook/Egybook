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
alter table public.posts enable row level security;
drop policy if exists "Posts readable by everyone" on public.posts;
create policy "Posts readable by everyone" on public.posts for select to anon, authenticated using (visibility = 'الجميع' or auth.uid() = user_id);
drop policy if exists "Users create own posts" on public.posts;
create policy "Users create own posts" on public.posts for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users update own posts" on public.posts;
create policy "Users update own posts" on public.posts for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users delete own posts" on public.posts;
create policy "Users delete own posts" on public.posts for delete to authenticated using (auth.uid() = user_id);

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
alter table public.verified_accounts enable row level security;
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
