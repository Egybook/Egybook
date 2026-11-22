-- EgyBook V219: align Neon Reel comment reactions with Home comment reactions.
-- Additive and data-preserving. Existing comment/reaction rows are not deleted.
BEGIN;

ALTER TABLE public.reel_comment_reactions
  DROP CONSTRAINT IF EXISTS reel_comment_reactions_reaction_check;

ALTER TABLE public.reel_comment_reactions
  ADD CONSTRAINT reel_comment_reactions_reaction_check
  CHECK (reaction IN ('👍','👎','❤️','😍','😂','😮','😢','😡'));

COMMIT;
