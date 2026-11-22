-- EgyBook V220 Phase 1: durable, idempotent Reels share counters.
-- Additive only. Existing reels, likes, comments and media are preserved.
BEGIN;

CREATE TABLE IF NOT EXISTS public.reel_shares (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reel_id bigint NOT NULL REFERENCES public.reels(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  event_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reel_shares_reel_event_key UNIQUE (reel_id, event_id),
  CONSTRAINT reel_shares_event_id_length CHECK (char_length(event_id) BETWEEN 8 AND 80)
);

CREATE INDEX IF NOT EXISTS idx_reel_shares_reel_created
  ON public.reel_shares (reel_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_reel_shares_user_created
  ON public.reel_shares (user_id, created_at DESC);

COMMIT;
