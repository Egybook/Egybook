-- EgyBook unified media views (posts images/videos, Moments, and Reels)
-- Run once in Supabase SQL Editor. Counts are unique per signed-in account per UTC day.
create table if not exists public.post_media_view_events (
  id bigint generated always as identity primary key,
  post_id uuid not null references public.posts(id) on delete cascade,
  viewer_id uuid not null references auth.users(id) on delete cascade,
  media_kind text not null check (media_kind in ('image','video')),
  view_day date not null default (timezone('utc', now())::date),
  created_at timestamptz not null default now(),
  constraint post_media_view_events_daily_unique unique (post_id, viewer_id, view_day)
);
create index if not exists post_media_view_events_post_idx on public.post_media_view_events(post_id, view_day);
alter table public.post_media_view_events enable row level security;
drop policy if exists "viewers insert own media views" on public.post_media_view_events;
create policy "viewers insert own media views" on public.post_media_view_events
 for insert to authenticated with check (viewer_id = auth.uid());
revoke all on public.post_media_view_events from anon, authenticated;
grant insert on public.post_media_view_events to authenticated;
revoke all on sequence public.post_media_view_events_id_seq from anon, authenticated;
grant usage, select on sequence public.post_media_view_events_id_seq to authenticated;

create or replace function public.record_post_media_view(p_post_id uuid, p_media_kind text)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_media_kind not in ('image','video') then raise exception 'invalid media kind'; end if;
  -- The caller must be able to read the post through the existing posts RLS policy.
  if not exists (select 1 from public.posts p where p.id = p_post_id and p.media_type = p_media_kind) then
    raise exception 'post is not available';
  end if;
  insert into public.post_media_view_events(post_id, viewer_id, media_kind, view_day)
  values (p_post_id, auth.uid(), p_media_kind, timezone('utc', now())::date)
  on conflict (post_id, viewer_id, view_day) do nothing;
end; $$;

create or replace function public.get_post_media_view_counts(p_post_ids uuid[])
returns table(post_id uuid, view_count bigint)
language sql stable security definer set search_path = public as $$
  select requested.post_id, count(e.id)::bigint as view_count
  from unnest(coalesce(p_post_ids, '{}'::uuid[])) as requested(post_id)
  left join public.post_media_view_events e on e.post_id = requested.post_id
  group by requested.post_id;
$$;
revoke all on function public.record_post_media_view(uuid,text) from public, anon;
grant execute on function public.record_post_media_view(uuid,text) to authenticated;
revoke all on function public.get_post_media_view_counts(uuid[]) from public, anon;
grant execute on function public.get_post_media_view_counts(uuid[]) to authenticated;
