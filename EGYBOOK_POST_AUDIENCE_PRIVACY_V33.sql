-- EgyBook post audience privacy migration v33
-- Additive migration. Keeps auth.users, profiles, existing posts, and media.
-- Run in Supabase SQL Editor AFTER uploading the matching v33 frontend.
begin;

create table if not exists public.close_friends (
  user_id uuid not null references auth.users(id) on delete cascade,
  friend_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  constraint close_friends_no_self check (user_id <> friend_id)
);
create index if not exists close_friends_friend_idx on public.close_friends(friend_id);

create table if not exists public.custom_audience_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'قائمة بلا تسمية',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, name)
);
create table if not exists public.custom_audience_list_members (
  list_id uuid not null references public.custom_audience_lists(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(list_id,user_id)
);
create index if not exists custom_audience_members_user_idx on public.custom_audience_list_members(user_id);

alter table public.posts add column if not exists audience_user_ids uuid[] not null default '{}';
alter table public.posts add column if not exists excluded_user_ids uuid[] not null default '{}';
alter table public.posts add column if not exists audience_list_id uuid;

do $drop_visibility_checks$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid='public.posts'::regclass and contype='c'
      and pg_get_constraintdef(oid) ilike '%visibility%'
  loop
    execute format('alter table public.posts drop constraint %I',c.conname);
  end loop;
end
$drop_visibility_checks$;

alter table public.posts add constraint posts_visibility_supported_values
check (visibility in (
  'الجميع','عام','الأصدقاء','الأصدقاء المقربون','استثناء',
  'أشخاص محددون','أنا فقط','قائمة مخصصة',
  'public','everyone','publico'
));

do $add_audience_fk$
begin
  if not exists(select 1 from pg_constraint where conrelid='public.posts'::regclass and conname='posts_audience_list_id_fkey') then
    alter table public.posts add constraint posts_audience_list_id_fkey
      foreign key (audience_list_id) references public.custom_audience_lists(id) on delete set null;
  end if;
end
$add_audience_fk$;

alter table public.close_friends enable row level security;
alter table public.custom_audience_lists enable row level security;
alter table public.custom_audience_list_members enable row level security;
grant select, insert, delete on public.close_friends to authenticated;
grant select, insert, update, delete on public.custom_audience_lists to authenticated;
grant select, insert, delete on public.custom_audience_list_members to authenticated;

drop policy if exists "close friends owner read" on public.close_friends;
create policy "close friends owner read" on public.close_friends for select to authenticated using (auth.uid()=user_id);
drop policy if exists "close friends owner insert" on public.close_friends;
create policy "close friends owner insert" on public.close_friends for insert to authenticated with check (auth.uid()=user_id and user_id<>friend_id);
drop policy if exists "close friends owner delete" on public.close_friends;
create policy "close friends owner delete" on public.close_friends for delete to authenticated using (auth.uid()=user_id);

drop policy if exists "audience lists owner read" on public.custom_audience_lists;
create policy "audience lists owner read" on public.custom_audience_lists for select to authenticated using (auth.uid()=user_id);
drop policy if exists "audience lists owner insert" on public.custom_audience_lists;
create policy "audience lists owner insert" on public.custom_audience_lists for insert to authenticated with check (auth.uid()=user_id);
drop policy if exists "audience lists owner update" on public.custom_audience_lists;
create policy "audience lists owner update" on public.custom_audience_lists for update to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);
drop policy if exists "audience lists owner delete" on public.custom_audience_lists;
create policy "audience lists owner delete" on public.custom_audience_lists for delete to authenticated using (auth.uid()=user_id);

drop policy if exists "audience members owner read" on public.custom_audience_list_members;
create policy "audience members owner read" on public.custom_audience_list_members for select to authenticated
using (exists(select 1 from public.custom_audience_lists l where l.id=list_id and l.user_id=auth.uid()));
drop policy if exists "audience members owner insert" on public.custom_audience_list_members;
create policy "audience members owner insert" on public.custom_audience_list_members for insert to authenticated
with check (exists(select 1 from public.custom_audience_lists l where l.id=list_id and l.user_id=auth.uid()));
drop policy if exists "audience members owner delete" on public.custom_audience_list_members;
create policy "audience members owner delete" on public.custom_audience_list_members for delete to authenticated
using (exists(select 1 from public.custom_audience_lists l where l.id=list_id and l.user_id=auth.uid()));

create or replace function public.egybook_can_view_post(
  p_owner uuid,
  p_visibility text,
  p_audience_user_ids uuid[],
  p_excluded_user_ids uuid[],
  p_audience_list_id uuid
) returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare viewer uuid := auth.uid();
begin
  if viewer is not null and viewer=p_owner then return true; end if;

  -- Legacy posts explicitly saved as "الجميع" remain public for compatibility.
  if lower(coalesce(p_visibility,'')) in ('الجميع','public','everyone','publico') then return true; end if;
  if viewer is null then return false; end if;

  if coalesce(p_visibility,'')='أنا فقط' then return false; end if;

  if coalesce(p_visibility,'')='أشخاص محددون' then
    return viewer = any(coalesce(p_audience_user_ids,'{}'::uuid[]));
  end if;

  if coalesce(p_visibility,'')='قائمة مخصصة' then
    return p_audience_list_id is not null and exists(
      select 1 from public.custom_audience_list_members m
      where m.list_id=p_audience_list_id and m.user_id=viewer
    );
  end if;

  if coalesce(p_visibility,'')='الأصدقاء المقربون' then
    return exists(select 1 from public.close_friends cf where cf.user_id=p_owner and cf.friend_id=viewer);
  end if;

  if coalesce(p_visibility,'')='استثناء' then
    if viewer=any(coalesce(p_excluded_user_ids,'{}'::uuid[])) then return false; end if;
    return exists(select 1 from public.friend_requests fr
      where fr.status='accepted' and ((fr.sender_id=p_owner and fr.receiver_id=viewer) or (fr.sender_id=viewer and fr.receiver_id=p_owner)))
      or exists(select 1 from public.user_follows f where f.follower_id=viewer and f.following_id=p_owner);
  end if;

  if coalesce(p_visibility,'')='الأصدقاء' then
    return exists(select 1 from public.friend_requests fr
      where fr.status='accepted' and ((fr.sender_id=p_owner and fr.receiver_id=viewer) or (fr.sender_id=viewer and fr.receiver_id=p_owner)));
  end if;

  -- "عام" means friends OR people who follow the author, not arbitrary visitors.
  if coalesce(p_visibility,'')='عام' then
    return exists(select 1 from public.friend_requests fr
      where fr.status='accepted' and ((fr.sender_id=p_owner and fr.receiver_id=viewer) or (fr.sender_id=viewer and fr.receiver_id=p_owner)))
      or exists(select 1 from public.user_follows f where f.follower_id=viewer and f.following_id=p_owner);
  end if;

  return false;
end;
$$;

grant execute on function public.egybook_can_view_post(uuid,text,uuid[],uuid[],uuid) to anon, authenticated;

-- Replace all SELECT/ALL policies on posts so an older permissive policy cannot bypass privacy.
do $drop_post_read_policies$
declare p record;
begin
  for p in select policyname,cmd from pg_policies where schemaname='public' and tablename='posts' and cmd in ('SELECT','ALL')
  loop
    execute format('drop policy if exists %I on public.posts',p.policyname);
  end loop;
end
$drop_post_read_policies$;

create policy "Posts visible according to audience" on public.posts
for select to anon, authenticated
using (public.egybook_can_view_post(user_id,visibility,audience_user_ids,excluded_user_ids,audience_list_id));

-- Keep write operations owner-only.
drop policy if exists "Users create own posts" on public.posts;
create policy "Users create own posts" on public.posts for insert to authenticated
with check (auth.uid()=user_id);
drop policy if exists "Users update own posts" on public.posts;
create policy "Users update own posts" on public.posts for update to authenticated
using (auth.uid()=user_id) with check (auth.uid()=user_id);
drop policy if exists "Users delete own posts" on public.posts;
create policy "Users delete own posts" on public.posts for delete to authenticated
using (auth.uid()=user_id);

create index if not exists posts_visibility_idx on public.posts(visibility);
create index if not exists posts_audience_list_idx on public.posts(audience_list_id);

notify pgrst, 'reload schema';
commit;
