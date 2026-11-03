-- EgyBook v194: secure aggregate counts for public profile follow statistics.
-- This returns only counts. It does NOT expose the follower/following user IDs,
-- change existing RLS policies, or modify relationship rows.
begin;

create or replace function public.get_profile_follow_counts(p_user_ids uuid[])
returns table (
  profile_id uuid,
  followers_count bigint,
  following_count bigint
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select
    requested.profile_id,
    (select count(*)::bigint
       from public.user_follows f
      where f.following_id = requested.profile_id) as followers_count,
    (select count(*)::bigint
       from public.user_follows f
      where f.follower_id = requested.profile_id) as following_count
  from (
    select distinct candidate.profile_id
      from unnest(coalesce(p_user_ids, array[]::uuid[])) as candidate(profile_id)
     where candidate.profile_id is not null
     limit 50
  ) as requested;
$function$;

revoke all on function public.get_profile_follow_counts(uuid[]) from public;
revoke all on function public.get_profile_follow_counts(uuid[]) from anon;
grant execute on function public.get_profile_follow_counts(uuid[]) to authenticated;

notify pgrst, 'reload schema';
commit;
