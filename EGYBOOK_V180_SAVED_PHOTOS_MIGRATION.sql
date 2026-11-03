-- EgyBook v180: persist saved photos from the album image viewer.
-- Additive migration. Does not touch or remove any existing media.

begin;

create table if not exists public.saved_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  photo_id text not null,
  media_url text not null,
  photo_kind text not null default 'album',
  created_at timestamptz not null default now(),
  constraint saved_photos_user_photo_unique unique (user_id, photo_id),
  constraint saved_photos_photo_id_nonempty check (length(btrim(photo_id)) > 0),
  constraint saved_photos_media_url_nonempty check (length(btrim(media_url)) > 0)
);

create index if not exists saved_photos_user_created_idx
  on public.saved_photos (user_id, created_at desc);

alter table public.saved_photos enable row level security;

drop policy if exists "Users read own saved photos" on public.saved_photos;
create policy "Users read own saved photos"
on public.saved_photos for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users save own photos" on public.saved_photos;
create policy "Users save own photos"
on public.saved_photos for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users remove own saved photos" on public.saved_photos;
create policy "Users remove own saved photos"
on public.saved_photos for delete
to authenticated
using (auth.uid() = user_id);

grant select, insert, delete on public.saved_photos to authenticated;

notify pgrst, 'reload schema';

commit;
