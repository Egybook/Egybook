-- EgyBook unified video analytics: Neon owns view sessions and completion metrics.
-- Safe additive migration; does not delete or rewrite existing reels/posts.
BEGIN;
CREATE TABLE IF NOT EXISTS public.reel_video_views (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reel_id bigint NOT NULL REFERENCES public.reels(id) ON DELETE CASCADE,
  viewer_user_id text NOT NULL,
  session_id uuid NOT NULL,
  watched_seconds numeric(12,3) NOT NULL DEFAULT 0 CHECK (watched_seconds >= 0),
  duration_seconds numeric(12,3) NULL CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reel_video_views_session_unique UNIQUE (reel_id, viewer_user_id, session_id)
);
CREATE INDEX IF NOT EXISTS idx_reel_video_views_reel_created
  ON public.reel_video_views (reel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reel_video_views_viewer_created
  ON public.reel_video_views (viewer_user_id, created_at DESC);
COMMIT;
