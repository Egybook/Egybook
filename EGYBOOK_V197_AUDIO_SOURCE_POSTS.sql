-- EgyBook v197: link a post to the original video post that supplies its audio.
-- Additive only: no rows are deleted and existing RLS policies are not changed.
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS audio_source_post_id uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'posts_audio_source_post_id_fkey'
      AND conrelid = 'public.posts'::regclass
  ) THEN
    ALTER TABLE public.posts
      ADD CONSTRAINT posts_audio_source_post_id_fkey
      FOREIGN KEY (audio_source_post_id)
      REFERENCES public.posts(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS posts_audio_source_post_id_idx
  ON public.posts(audio_source_post_id)
  WHERE audio_source_post_id IS NOT NULL;

COMMENT ON COLUMN public.posts.audio_source_post_id IS
  'Optional source post whose video soundtrack is reused; access is governed by posts RLS.';
