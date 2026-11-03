-- EgyBook v181: durable profile/cover image history, independent from timeline posts.
-- Supabase stores metadata and R2 URLs only; media bytes remain in Cloudflare R2.
-- Old profile images are retained when the current avatar/cover pointer changes.

begin;

create table if not exists public.profile_media_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('avatar','cover')),
  media_url text not null,
  source_post_id uuid,
  visibility text not null default 'عام',
  created_at timestamptz default now(),
  constraint profile_media_history_media_url_nonempty check (length(btrim(media_url)) > 0),
  constraint profile_media_history_owner_kind_url_unique unique (user_id,kind,media_url)
);

create index if not exists profile_media_history_owner_kind_date_idx
  on public.profile_media_history (user_id,kind,created_at desc);

-- Legacy rows may not have a reliable image-specific timestamp. Keep the image,
-- but allow its original date to remain NULL rather than inventing a date.
alter table public.profile_media_history alter column created_at drop not null;

alter table public.profile_media_history enable row level security;

-- Reuse EgyBook's canonical audience rules when that helper exists; otherwise
-- restrict private/friends-only rows to the owner and accepted friends/followers.
create or replace function public.egybook_can_view_profile_media(p_owner uuid,p_visibility text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  viewer uuid := auth.uid();
  allowed boolean := false;
  vis text := coalesce(p_visibility,'');
begin
  if viewer is not null and viewer=p_owner then return true; end if;
  if lower(vis) in ('public','everyone','الجميع') or vis='عام' then return true; end if;
  if viewer is null then return false; end if;
  if vis in ('أنا فقط','private','only_me') then return false; end if;

  if to_regprocedure('public.egybook_can_view_post(uuid,text,uuid[],uuid[],uuid)') is not null then
    return public.egybook_can_view_post(p_owner,vis,'{}'::uuid[],'{}'::uuid[],null);
  end if;

  if vis in ('الأصدقاء','عام') and to_regclass('public.friend_requests') is not null then
    execute 'select exists(select 1 from public.friend_requests fr where fr.status=''accepted'' and ((fr.sender_id=$1 and fr.receiver_id=$2) or (fr.sender_id=$2 and fr.receiver_id=$1)))'
      into allowed using p_owner,viewer;
    if allowed then return true; end if;
  end if;
  if vis='عام' and to_regclass('public.user_follows') is not null then
    execute 'select exists(select 1 from public.user_follows f where f.follower_id=$1 and f.following_id=$2)'
      into allowed using viewer,p_owner;
    if allowed then return true; end if;
  end if;
  if vis='الأصدقاء المقربون' and to_regclass('public.close_friends') is not null then
    execute 'select exists(select 1 from public.close_friends cf where cf.user_id=$1 and cf.friend_id=$2)'
      into allowed using p_owner,viewer;
    if allowed then return true; end if;
  end if;
  return false;
end;
$$;

grant execute on function public.egybook_can_view_profile_media(uuid,text) to anon,authenticated;

-- Ensure standalone-photo interaction tables are available for profile/cover
-- history items even if an earlier optional social-interactions migration was
-- not run yet. These tables store IDs/text only, never media bytes.
create table if not exists public.photo_reactions (
  id uuid primary key default gen_random_uuid(),
  photo_id text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (photo_id,user_id)
);
alter table public.photo_reactions add column if not exists updated_at timestamptz not null default now();
alter table public.photo_reactions drop constraint if exists photo_reactions_reaction_check;
alter table public.photo_reactions add constraint photo_reactions_reaction_check
  check (reaction in ('👍','❤️','😍','😂','😮','😢','😡'));
create index if not exists photo_reactions_photo_id_idx on public.photo_reactions(photo_id);
alter table public.photo_reactions enable row level security;
grant select on public.photo_reactions to anon,authenticated;
grant insert,update,delete on public.photo_reactions to authenticated;
drop policy if exists "Photo reactions are publicly readable" on public.photo_reactions;
drop policy if exists "Photo reactions follow photo visibility" on public.photo_reactions;
create policy "Photo reactions follow photo visibility" on public.photo_reactions for select to anon,authenticated using (
  exists(select 1 from public.profile_media_history h where h.id::text=photo_id and public.egybook_can_view_profile_media(h.user_id,h.visibility))
  or exists(select 1 from public.photo_album_items ai where ai.id::text=photo_id)
);
drop policy if exists "Users add own photo reactions" on public.photo_reactions;
create policy "Users add own photo reactions" on public.photo_reactions for insert to authenticated with check (
  auth.uid()=user_id and (
    exists(select 1 from public.profile_media_history h where h.id::text=photo_id and public.egybook_can_view_profile_media(h.user_id,h.visibility))
    or exists(select 1 from public.photo_album_items ai where ai.id::text=photo_id)
  )
);
drop policy if exists "Users update own photo reactions" on public.photo_reactions;
create policy "Users update own photo reactions" on public.photo_reactions for update to authenticated
using (auth.uid()=user_id and (
  exists(select 1 from public.profile_media_history h where h.id::text=photo_id and public.egybook_can_view_profile_media(h.user_id,h.visibility))
  or exists(select 1 from public.photo_album_items ai where ai.id::text=photo_id)
))
with check (auth.uid()=user_id and (
  exists(select 1 from public.profile_media_history h where h.id::text=photo_id and public.egybook_can_view_profile_media(h.user_id,h.visibility))
  or exists(select 1 from public.photo_album_items ai where ai.id::text=photo_id)
));
drop policy if exists "Users delete own photo reactions" on public.photo_reactions;
create policy "Users delete own photo reactions" on public.photo_reactions for delete to authenticated using (auth.uid()=user_id);

create table if not exists public.photo_comments (
  id uuid primary key default gen_random_uuid(),
  photo_id text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  user_name text not null default 'عضو EgyBook',
  body text not null check (length(trim(body)) between 1 and 5000),
  created_at timestamptz not null default now()
);
alter table public.photo_comments add column if not exists user_name text not null default 'عضو EgyBook';
alter table public.photo_comments add column if not exists created_at timestamptz not null default now();
create index if not exists photo_comments_photo_created_idx on public.photo_comments(photo_id,created_at);
alter table public.photo_comments enable row level security;
grant select on public.photo_comments to anon,authenticated;
grant insert,delete on public.photo_comments to authenticated;
drop policy if exists "Photo comments are publicly readable" on public.photo_comments;
drop policy if exists "Photo comments follow photo visibility" on public.photo_comments;
create policy "Photo comments follow photo visibility" on public.photo_comments for select to anon,authenticated using (
  exists(select 1 from public.profile_media_history h where h.id::text=photo_id and public.egybook_can_view_profile_media(h.user_id,h.visibility))
  or exists(select 1 from public.photo_album_items ai where ai.id::text=photo_id)
);
drop policy if exists "Users add own photo comments" on public.photo_comments;
create policy "Users add own photo comments" on public.photo_comments for insert to authenticated with check (
  auth.uid()=user_id and (
    exists(select 1 from public.profile_media_history h where h.id::text=photo_id and public.egybook_can_view_profile_media(h.user_id,h.visibility))
    or exists(select 1 from public.photo_album_items ai where ai.id::text=photo_id)
  )
);
drop policy if exists "Users delete own photo comments" on public.photo_comments;
create policy "Users delete own photo comments" on public.photo_comments for delete to authenticated using (auth.uid()=user_id);



drop policy if exists "profile_media_history_select_visible" on public.profile_media_history;
create policy "profile_media_history_select_visible"
on public.profile_media_history for select to anon,authenticated
using (public.egybook_can_view_profile_media(user_id,visibility));

drop policy if exists "profile_media_history_insert_owner" on public.profile_media_history;
create policy "profile_media_history_insert_owner"
on public.profile_media_history for insert to authenticated
with check (auth.uid()=user_id);

drop policy if exists "profile_media_history_update_owner" on public.profile_media_history;
create policy "profile_media_history_update_owner"
on public.profile_media_history for update to authenticated
using (auth.uid()=user_id) with check (auth.uid()=user_id);

drop policy if exists "profile_media_history_delete_owner" on public.profile_media_history;
create policy "profile_media_history_delete_owner"
on public.profile_media_history for delete to authenticated
using (auth.uid()=user_id);

grant select on public.profile_media_history to anon,authenticated;
grant insert,update,delete on public.profile_media_history to authenticated;

-- Backfill historical profile-photo activity posts already in Supabase.
-- The independent row survives later deletion of the activity post.
insert into public.profile_media_history(user_id,kind,media_url,source_post_id,visibility,created_at)
select p.user_id,
       case
         when p.activity='profile_avatar_update'
           or coalesce(p.text,'') ~* '(تحديث|تغيير|تعديل).{0,45}(الصورة الشخصية|صورته الشخصية|صورة البروفايل|صورة الملف الشخصي|صورة حسابه|صورته)'
           or coalesce(p.text,'') ~* '(الصورة الشخصية|صورته الشخصية).{0,45}(تحديث|تغيير|تعديل)'
         then 'avatar' else 'cover' end,
       coalesce(p.media_url,nullif(p.media_urls->>0,'')),p.id,coalesce(p.visibility,'عام'),p.created_at
from public.posts p
where coalesce(p.media_url,nullif(p.media_urls->>0,'')) is not null
  and (p.activity in ('profile_avatar_update','profile_cover_update')
       or p.text ~* '(تحديث|تغيير|تعديل).{0,45}(الصورة الشخصية|صورته الشخصية|صورة الملف الشخصي|صورة البروفايل|صورة حسابه|صورة الغلاف|صورة غلافه|غلافه)'
       or p.text ~* '(الصورة الشخصية|صورته الشخصية|صورة الملف الشخصي|صورة البروفايل|صورة حسابه|صورة الغلاف|صورة غلافه|غلافه).{0,45}(تحديث|تغيير|تعديل)')
on conflict (user_id,kind,media_url) do update
set source_post_id=coalesce(public.profile_media_history.source_post_id,excluded.source_post_id),
    visibility=excluded.visibility,
    created_at=least(public.profile_media_history.created_at,excluded.created_at);

notify pgrst, 'reload schema';
commit;
