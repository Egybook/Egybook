-- EgyBook unified video model (Facebook-style): one canonical Neon row per video.
-- Allows one Supabase post to contain multiple video attachments while each
-- canonical video remains linked to at most one source post. Existing rows stay.
BEGIN;

ALTER TABLE public.reel_post_links
  DROP CONSTRAINT IF EXISTS reel_post_links_pkey;

ALTER TABLE public.reel_post_links
  ADD CONSTRAINT reel_post_links_pkey PRIMARY KEY (post_id, reel_id);

-- Keep the existing UNIQUE(reel_id) constraint: one video belongs to one post.
CREATE INDEX IF NOT EXISTS idx_reel_post_links_post_created
  ON public.reel_post_links (post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reel_post_links_user_created
  ON public.reel_post_links (user_id, created_at DESC);

COMMIT;
