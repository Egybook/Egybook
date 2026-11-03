-- EgyBook v193: Friend presence + privacy setup
-- Run once in Supabase SQL Editor if these columns/policy are not already installed.
-- Safe to run more than once. Does not delete or rewrite accounts, posts, or friendships.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS activity_privacy text NOT NULL DEFAULT 'friends';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_activity_privacy_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_activity_privacy_check
  CHECK (activity_privacy IN ('friends','hidden','private','public'));

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'profiles_update_own_presence_timestamp'
  ) THEN
    CREATE POLICY profiles_update_own_presence_timestamp
      ON public.profiles
      FOR UPDATE
      TO authenticated
      USING (auth.uid() = id)
      WITH CHECK (auth.uid() = id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS friend_requests_accepted_sender_receiver_idx
  ON public.friend_requests (sender_id, receiver_id, status);

-- RLS still limits last_seen_at updates to the authenticated user's own profile row.
