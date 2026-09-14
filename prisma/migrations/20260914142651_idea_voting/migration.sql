-- CreateIndex
CREATE INDEX "ideas_vote_count_created_at_idx" ON "innovation"."ideas"("vote_count" DESC, "created_at" DESC);

-- CreateIndex
CREATE INDEX "ideas_comment_count_created_at_idx" ON "innovation"."ideas"("comment_count" DESC, "created_at" DESC);

-- ===========================================================================
-- Raw SQL: the vote counter kept by the database, and row-level security on
-- idea_votes. (The indexes above are Prisma's.)
--
-- Duplicate votes were already impossible: the primary key of idea_votes is
-- (idea_id, user_id), a database-level unique constraint that also serves
-- lookups by idea; idea_votes_user_id_idx serves lookups by person.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The vote counter follows the votes table, whoever writes to it
-- ---------------------------------------------------------------------------
-- Until now the application moved ideas.vote_count in the same transaction as
-- the vote. A trigger keeps it right for ANY writer, so the count can never drift
-- from the rows. It deliberately does not touch updated_at: a vote is not an edit.
CREATE OR REPLACE FUNCTION "innovation"."idea_votes_count"()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE innovation.ideas SET vote_count = vote_count + 1 WHERE id = NEW.idea_id;
  ELSE
    UPDATE innovation.ideas SET vote_count = GREATEST(vote_count - 1, 0) WHERE id = OLD.idea_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "idea_votes_count"
  AFTER INSERT OR DELETE ON "innovation"."idea_votes"
  FOR EACH ROW
  EXECUTE FUNCTION "innovation"."idea_votes_count"();

-- Existing counts, made exact once.
UPDATE "innovation"."ideas" i
   SET "vote_count" = (SELECT count(*) FROM "innovation"."idea_votes" v WHERE v."idea_id" = i."id")
 WHERE "vote_count" <> (SELECT count(*) FROM "innovation"."idea_votes" v WHERE v."idea_id" = i."id");

-- ---------------------------------------------------------------------------
-- 2. Row-level security on idea_votes
-- ---------------------------------------------------------------------------
-- Signed-in, active people may see votes, add their own vote on a live idea, and
-- remove their own vote — never create or delete anyone else's. The application
-- enforces the same rules in its service; these policies are what hold for any
-- connection that is not the table owner (ADR-015). No table is granted to the
-- API roles, so the browser still reaches votes only through the application.
CREATE OR REPLACE FUNCTION "innovation"."requesting_user_id"()
  RETURNS uuid
  LANGUAGE sql
  STABLE
AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

CREATE OR REPLACE FUNCTION "innovation"."is_active_user"(p_user_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM iam.users u
     WHERE u.id = p_user_id AND u.is_active AND u.deleted_at IS NULL
  )
$$;

CREATE OR REPLACE FUNCTION "innovation"."idea_is_live"(p_idea_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM innovation.ideas i WHERE i.id = p_idea_id AND i.deleted_at IS NULL
  )
$$;

CREATE POLICY "idea_votes_read" ON "innovation"."idea_votes"
  FOR SELECT
  USING ("innovation"."is_active_user"((SELECT "innovation"."requesting_user_id"())));

CREATE POLICY "idea_votes_add_own" ON "innovation"."idea_votes"
  FOR INSERT
  WITH CHECK (
    "user_id" = (SELECT "innovation"."requesting_user_id"())
    AND "innovation"."is_active_user"("user_id")
    AND "innovation"."idea_is_live"("idea_id")
  );

CREATE POLICY "idea_votes_remove_own" ON "innovation"."idea_votes"
  FOR DELETE
  USING ("user_id" = (SELECT "innovation"."requesting_user_id"()));

-- Definer-rights helpers are not for calling directly.
REVOKE ALL ON FUNCTION "innovation"."is_active_user"(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION "innovation"."idea_is_live"(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION "innovation"."idea_votes_count"() FROM PUBLIC;
