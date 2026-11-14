-- EgyBook V37 media views: count distinct playback sessions (no 24-hour lockout).
-- Existing view events are preserved; each historical row receives its own session UUID.
alter table public.post_media_view_events
  add column if not exists view_session_id uuid not null default gen_random_uuid();

alter table public.post_media_view_events
  drop constraint if exists post_media_view_events_daily_unique;

create unique index if not exists post_media_view_events_session_unique
  on public.post_media_view_events(post_id, viewer_id, view_session_id);

create index if not exists post_media_view_events_post_idx
  on public.post_media_view_events(post_id);

drop function if exists public.record_post_media_view(uuid,text,uuid);
create function public.record_post_media_view(
  p_post_id uuid,
  p_media_kind text,
  p_view_session_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  inserted_count integer;
  post_kind text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_media_kind not in ('image','video') then raise exception 'invalid media kind'; end if;
  if p_view_session_id is null then raise exception 'view session required'; end if;

  select lower(coalesce(p.media_type,'')) into post_kind
  from public.posts p where p.id = p_post_id;

  if post_kind is null then raise exception 'post is not available'; end if;
  if p_media_kind='image' and post_kind not in ('image','photo','moment','moment_image') then
    raise exception 'post is not an image';
  end if;
  if p_media_kind='video' and post_kind not in ('video','reel','moment','moment_video') then
    raise exception 'post is not a video';
  end if;

  insert into public.post_media_view_events(post_id,viewer_id,media_kind,view_day,view_session_id)
  values(p_post_id,auth.uid(),p_media_kind,timezone('utc',now())::date,p_view_session_id)
  on conflict(post_id,viewer_id,view_session_id) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count > 0;
end;
$$;

-- Keep the previous two-argument RPC available for older clients during rollout.
drop function if exists public.record_post_media_view(uuid,text);
create function public.record_post_media_view(p_post_id uuid,p_media_kind text)
returns boolean
language sql
security invoker
set search_path = public
as $$
  select public.record_post_media_view(p_post_id,p_media_kind,gen_random_uuid());
$$;

create or replace function public.get_post_media_view_counts(p_post_ids uuid[])
returns table(post_id uuid, view_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select requested.post_id,count(e.id)::bigint
  from unnest(coalesce(p_post_ids,'{}'::uuid[])) as requested(post_id)
  left join public.post_media_view_events e on e.post_id=requested.post_id
  group by requested.post_id;
$$;

revoke all on function public.record_post_media_view(uuid,text,uuid) from public,anon;
grant execute on function public.record_post_media_view(uuid,text,uuid) to authenticated;
revoke all on function public.record_post_media_view(uuid,text) from public,anon;
grant execute on function public.record_post_media_view(uuid,text) to authenticated;
revoke all on function public.get_post_media_view_counts(uuid[]) from public,anon;
grant execute on function public.get_post_media_view_counts(uuid[]) to authenticated;
