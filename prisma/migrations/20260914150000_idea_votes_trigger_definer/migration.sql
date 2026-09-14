-- ---------------------------------------------------------------------------
-- The self-vote rule must run with its owner's rights
-- ---------------------------------------------------------------------------
-- idea_votes_not_own (20260914123231_innovation_module) read innovation.ideas with
-- the rights of whoever inserted the vote. The application inserts as the table
-- owner, so it worked there — but any other role, the very connection the policies
-- above exist for, was refused with "permission denied for table ideas" on every
-- vote. Definer rights, like the other helpers, with the search path pinned.
CREATE OR REPLACE FUNCTION "innovation"."idea_votes_not_own"()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM innovation.ideas i
     WHERE i.id = NEW.idea_id AND i.created_by = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'innovation: people cannot vote for their own ideas';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION "innovation"."idea_votes_not_own"() FROM PUBLIC;
