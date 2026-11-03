-- EgyBook v178: persistent custom photo albums.
-- Supabase stores album metadata and R2 object references only.
-- Image/video bytes remain in Cloudflare R2; this migration uploads/deletes no media.

begin;

create table if not exists public.photo_albums (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 60),
  cover_url text,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists photo_albums_user_created_idx
  on public.photo_albums (user_id, created_at desc);

create table if not exists public.photo_album_items (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references public.photo_albums(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  media_url text not null,
  r2_key text,
  caption text,
  source_post_id uuid references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint photo_album_items_media_url_nonempty check (length(btrim(media_url)) > 0)
);

create index if not exists photo_album_items_album_created_idx
  on public.photo_album_items (album_id, created_at desc);
create index if not exists photo_album_items_user_idx
  on public.photo_album_items (user_id);

alter table public.photo_albums enable row level security;
alter table public.photo_album_items enable row level security;

drop policy if exists "photo_albums_select_public_or_owner" on public.photo_albums;
create policy "photo_albums_select_public_or_owner"
on public.photo_albums for select
using (is_public = true or auth.uid() = user_id);

drop policy if exists "photo_albums_insert_owner" on public.photo_albums;
create policy "photo_albums_insert_owner"
on public.photo_albums for insert
with check (auth.uid() = user_id);

drop policy if exists "photo_albums_update_owner" on public.photo_albums;
create policy "photo_albums_update_owner"
on public.photo_albums for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "photo_albums_delete_owner" on public.photo_albums;
create policy "photo_albums_delete_owner"
on public.photo_albums for delete
using (auth.uid() = user_id);

drop policy if exists "photo_album_items_select_visible_album" on public.photo_album_items;
create policy "photo_album_items_select_visible_album"
on public.photo_album_items for select
using (
  exists (
    select 1 from public.photo_albums a
    where a.id = album_id
      and (a.is_public = true or a.user_id = auth.uid())
  )
);

drop policy if exists "photo_album_items_insert_album_owner" on public.photo_album_items;
create policy "photo_album_items_insert_album_owner"
on public.photo_album_items for insert
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.photo_albums a
    where a.id = album_id and a.user_id = auth.uid()
  )
);

drop policy if exists "photo_album_items_delete_album_owner" on public.photo_album_items;
create policy "photo_album_items_delete_album_owner"
on public.photo_album_items for delete
using (
  exists (
    select 1 from public.photo_albums a
    where a.id = album_id and a.user_id = auth.uid()
  )
);

grant select on public.photo_albums to anon, authenticated;
grant insert, update, delete on public.photo_albums to authenticated;
grant select on public.photo_album_items to anon, authenticated;
grant insert, delete on public.photo_album_items to authenticated;

commit;
