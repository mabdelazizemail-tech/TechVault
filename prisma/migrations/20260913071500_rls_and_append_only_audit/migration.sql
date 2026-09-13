-- Defence in depth at the database layer (CLAUDE.md ADR-002, §18.6).
--
-- Three independent controls, each useful on its own:
--
--   1. Row-level security enabled deny-by-default on every table.
--   2. Every privilege revoked from the PostgREST API roles.
--   3. An append-only trigger on platform.audit_log.
--
-- WHAT THE PRIMARY CONTROL ACTUALLY IS TODAY: the `iam` and `platform` schemas are
-- not in Supabase's exposed-schemas list (only `public, graphql_public` are), so
-- PostgREST refuses them outright — verified by probing the REST API with the
-- publishable key, which returns PGRST106 "Only the following schemas are
-- exposed". This migration exists because that control is a DASHBOARD SETTING
-- anyone can change. If someone ever adds `iam` to exposed schemas, the anon and
-- authenticated roles must still get nothing.
--
-- WHY RLS DOES NOT BREAK THE APPLICATION: the application connects as `postgres`,
-- which owns these tables, and a table owner bypasses row-level security unless
-- FORCE ROW LEVEL SECURITY is set. It is deliberately NOT set. Enabling RLS
-- therefore changes nothing for the app and everything for any other role. The
-- complete fix is a dedicated, less-privileged application role; see §29.

-- ---------------------------------------------------------------------------
-- 1. Enable RLS deny-by-default on every table in both schemas.
-- ---------------------------------------------------------------------------
-- No policies are created. With RLS enabled and no policy, a non-owning role
-- matches zero rows for every operation — which is the correct default for data
-- that should never be read directly by a client.
--
-- A table added in a later migration is NOT covered by this one. Enable RLS on it
-- in the migration that creates it.
DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT schemaname, tablename
      FROM pg_tables
     WHERE schemaname IN ('iam', 'platform')
     ORDER BY schemaname, tablename
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
      target.schemaname, target.tablename
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Revoke everything from the API roles.
-- ---------------------------------------------------------------------------
-- Guarded by role existence: `anon` and `authenticated` are Supabase-specific and
-- do not exist on a plain Postgres, which is what the integration-test database
-- is. An unguarded REVOKE would make this migration fail there.
DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA iam FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON SCHEMA platform FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA iam FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA platform FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA iam FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA platform FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL ROUTINES IN SCHEMA iam FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL ROUTINES IN SCHEMA platform FROM %I', api_role);

      -- And for anything created later by this migration's owner.
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA iam REVOKE ALL ON TABLES FROM %I',
        api_role
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA platform REVOKE ALL ON TABLES FROM %I',
        api_role
      );
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. platform.audit_log is append-only, enforced by the database.
-- ---------------------------------------------------------------------------
-- §18.6 requires that no update or delete path exists. A GRANT cannot express
-- that here, because the application connects as the table's owner and an owner
-- keeps its rights. A trigger applies to every role including the owner, so it is
-- the control that actually holds.
--
-- TRUNCATE is deliberately NOT blocked: it fires a different trigger event, and
-- the integration suite needs it to reset fixtures. TRUNCATE requires ownership,
-- so ordinary application code cannot reach it — closing that last gap needs the
-- dedicated application role tracked in §29.
CREATE OR REPLACE FUNCTION platform.audit_log_append_only()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  -- Deliberately NO custom ERRCODE. Setting one in the integrity-violation class
  -- (23xxx) makes Prisma report this as "Foreign key constraint violated" and
  -- discard the message, hiding the real reason from whoever hits it. The default
  -- raise_exception (P0001) surfaces the text.
  RAISE EXCEPTION
    'platform.audit_log is append-only; % is not permitted (CLAUDE.md 18.6)',
    TG_OP;
END;
$$;

COMMENT ON FUNCTION platform.audit_log_append_only() IS
  'Rejects UPDATE and DELETE on platform.audit_log. An audit trail that can be edited is not an audit trail.';

DROP TRIGGER IF EXISTS audit_log_no_update ON platform.audit_log;
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON platform.audit_log
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform.audit_log_append_only();

DROP TRIGGER IF EXISTS audit_log_no_delete ON platform.audit_log;
CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON platform.audit_log
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform.audit_log_append_only();
