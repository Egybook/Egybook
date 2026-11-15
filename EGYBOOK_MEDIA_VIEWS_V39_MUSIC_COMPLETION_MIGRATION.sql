-- EgyBook V39: completion percentage for Moments (image + attached music).
-- Run AFTER EGYBOOK_MEDIA_VIEWS_V38_COMPLETION_MIGRATION.sql.
-- Existing view rows and RLS policies are preserved.

CREATE OR REPLACE FUNCTION public.record_post_media_view(
  p_post_id uuid,
  p_media_kind text,
  p_view_session_id uuid,
  p_watched_seconds numeric,
  p_media_duration_seconds numeric
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  inserted_count integer;
  post_kind text;
  safe_watched numeric(10,3);
  safe_duration numeric(10,3);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF p_media_kind NOT IN ('image','video') THEN RAISE EXCEPTION 'invalid media kind'; END IF;
  IF p_view_session_id IS NULL THEN RAISE EXCEPTION 'view session required'; END IF;

  SELECT lower(coalesce(p.media_type,'')) INTO post_kind
  FROM public.posts p WHERE p.id=p_post_id;
  IF post_kind IS NULL THEN RAISE EXCEPTION 'post is not available'; END IF;
  IF p_media_kind='image' AND post_kind NOT IN ('image','photo','moment','moment_image') THEN
    RAISE EXCEPTION 'post is not an image';
  END IF;
  IF p_media_kind='video' AND post_kind NOT IN ('video','reel','moment','moment_video') THEN
    RAISE EXCEPTION 'post is not a video';
  END IF;

  safe_watched := LEAST(GREATEST(coalesce(p_watched_seconds,0),0),86400);
  safe_duration := CASE WHEN p_media_duration_seconds IS NULL OR p_media_duration_seconds<=0
    THEN NULL ELSE LEAST(p_media_duration_seconds,86400) END;

  INSERT INTO public.post_media_view_events(
    post_id,viewer_id,media_kind,view_day,view_session_id,
    watched_seconds,media_duration_seconds,completion_percent
  ) VALUES (
    p_post_id,auth.uid(),p_media_kind,timezone('utc',now())::date,p_view_session_id,
    safe_watched,safe_duration,
    CASE WHEN safe_duration>0 THEN LEAST(100,round((safe_watched/safe_duration)*100,2)) ELSE NULL END
  ) ON CONFLICT(post_id,viewer_id,view_session_id) DO NOTHING;

  GET DIAGNOSTICS inserted_count=ROW_COUNT;
  IF inserted_count>0 THEN RETURN true; END IF;

  UPDATE public.post_media_view_events e
  SET watched_seconds=GREATEST(coalesce(e.watched_seconds,0),safe_watched),
      media_duration_seconds=coalesce(safe_duration,e.media_duration_seconds),
      completion_percent=CASE
        WHEN coalesce(safe_duration,e.media_duration_seconds)>0 THEN GREATEST(
          coalesce(e.completion_percent,0),
          LEAST(100,round((GREATEST(coalesce(e.watched_seconds,0),safe_watched)/
            coalesce(safe_duration,e.media_duration_seconds))*100,2))
        ) ELSE e.completion_percent END
  WHERE e.post_id=p_post_id AND e.viewer_id=auth.uid() AND e.view_session_id=p_view_session_id;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_post_media_view_stats(p_post_ids uuid[])
RETURNS TABLE(post_id uuid,view_count bigint,avg_completion_percent numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT requested.post_id,count(e.id)::bigint,
    round(avg(e.completion_percent) FILTER (WHERE e.completion_percent IS NOT NULL),1)
  FROM unnest(coalesce(p_post_ids,'{}'::uuid[])) AS requested(post_id)
  LEFT JOIN public.post_media_view_events e ON e.post_id=requested.post_id
  GROUP BY requested.post_id;
$$;

REVOKE ALL ON FUNCTION public.record_post_media_view(uuid,text,uuid,numeric,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_post_media_view(uuid,text,uuid,numeric,numeric) TO authenticated;
REVOKE ALL ON FUNCTION public.get_post_media_view_stats(uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_post_media_view_stats(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.get_post_media_view_stats(uuid[])
  IS 'Returns per-post view sessions and average completion for videos and music-attached image Moments.';
