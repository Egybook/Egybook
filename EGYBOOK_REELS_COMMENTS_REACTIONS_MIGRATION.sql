-- EgyBook Reels: durable nested comments, reactions and in-app notification events.
-- Additive migration. Existing reels, comments and likes are preserved.
BEGIN;

ALTER TABLE public.reel_comments
  ADD COLUMN IF NOT EXISTS parent_comment_id bigint NULL REFERENCES public.reel_comments(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS edited_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_reel_comments_reel_created
  ON public.reel_comments (reel_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_reel_comments_parent
  ON public.reel_comments (parent_comment_id, created_at ASC, id ASC)
  WHERE parent_comment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reel_comments_user
  ON public.reel_comments (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.reel_comment_reactions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  comment_id bigint NOT NULL REFERENCES public.reel_comments(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  reaction text NOT NULL CHECK (reaction IN ('👍','❤️','😮','😂','😢','😡')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reel_comment_reactions_comment_user_key UNIQUE (comment_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_reel_comment_reactions_comment
  ON public.reel_comment_reactions (comment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reel_comment_reactions_user
  ON public.reel_comment_reactions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.reel_comment_notifications (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recipient_user_id text NOT NULL,
  actor_user_id text NOT NULL,
  reel_id bigint NOT NULL REFERENCES public.reels(id) ON DELETE CASCADE,
  comment_id bigint NOT NULL REFERENCES public.reel_comments(id) ON DELETE CASCADE,
  notification_type text NOT NULL CHECK (notification_type IN ('reply','reaction')),
  reaction text NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reel_comment_notifications_recipient
  ON public.reel_comment_notifications (recipient_user_id, created_at DESC);

COMMIT;
