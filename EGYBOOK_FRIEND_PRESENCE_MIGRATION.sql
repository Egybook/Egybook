-- EgyBook: real last-seen timestamps for friends-only status labels.
-- Run once in Supabase SQL Editor. Existing friend relationships remain the authority
-- for which users receive a status label in the UI.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

-- Permit an authenticated user to update only their own profile row for last_seen_at.
-- This does not grant access to another user's profile row.
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
