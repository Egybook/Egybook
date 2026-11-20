-- EgyBook: stable link between Supabase video posts and Neon reels.
-- Run in the Neon SQL Editor for project egybook-reels.
BEGIN;
CREATE TABLE IF NOT EXISTS public.reel_post_links (
  post_id text PRIMARY KEY,
  reel_id bigint NOT NULL UNIQUE REFERENCES public.reels(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reel_post_links_user ON public.reel_post_links(user_id, created_at DESC);
COMMIT;
