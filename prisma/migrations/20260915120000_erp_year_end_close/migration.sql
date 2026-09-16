-- CreateTable
CREATE TABLE "erp"."fiscal_year_closes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "year" INTEGER NOT NULL,
    "journal_entry_id" UUID,
    "net_income_minor" BIGINT NOT NULL,
    "retained_earnings_account_id" UUID NOT NULL,
    "closed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_by" UUID NOT NULL,
    "reopened_at" TIMESTAMPTZ(6),
    "reopened_by" UUID,
    "reopen_reason" TEXT,
    "reopen_journal_entry_id" UUID,

    CONSTRAINT "fiscal_year_closes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_year_closes_journal_entry_id_key" ON "erp"."fiscal_year_closes"("journal_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_year_closes_reopen_journal_entry_id_key" ON "erp"."fiscal_year_closes"("reopen_journal_entry_id");

-- CreateIndex
CREATE INDEX "fiscal_year_closes_year_idx" ON "erp"."fiscal_year_closes"("year");

-- AddForeignKey
ALTER TABLE "erp"."fiscal_year_closes" ADD CONSTRAINT "fiscal_year_closes_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "erp"."journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."fiscal_year_closes" ADD CONSTRAINT "fiscal_year_closes_reopen_journal_entry_id_fkey" FOREIGN KEY ("reopen_journal_entry_id") REFERENCES "erp"."journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."fiscal_year_closes" ADD CONSTRAINT "fiscal_year_closes_retained_earnings_account_id_fkey" FOREIGN KEY ("retained_earnings_account_id") REFERENCES "erp"."accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."fiscal_year_closes" ADD CONSTRAINT "fiscal_year_closes_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."fiscal_year_closes" ADD CONSTRAINT "fiscal_year_closes_reopened_by_fkey" FOREIGN KEY ("reopened_by") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- Year-end close invariants (ADR-028). They hold for every writer, including the
-- owner connection the application uses.
-- ===========================================================================

-- One live (not reopened) close per year. Reopened closes stay as history.
CREATE UNIQUE INDEX "fiscal_year_closes_one_live_close"
  ON "erp"."fiscal_year_closes" ("year") WHERE "reopened_at" IS NULL;

ALTER TABLE "erp"."fiscal_year_closes"
  ADD CONSTRAINT "fiscal_year_closes_year_range" CHECK ("year" BETWEEN 1900 AND 9999),
  ADD CONSTRAINT "fiscal_year_closes_reopen_complete" CHECK (
    ("reopened_at" IS NULL) = ("reopened_by" IS NULL)
    AND ("reopened_at" IS NULL) = ("reopen_reason" IS NULL)
    AND ("reopen_journal_entry_id" IS NULL OR "reopened_at" IS NOT NULL)
  );

-- A close is history: never deleted, and changed only by being reopened, once.
CREATE OR REPLACE FUNCTION "erp"."fiscal_year_closes_guard"()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'erp: a fiscal year close cannot be deleted; reopen the year instead';
  END IF;

  IF NEW.id <> OLD.id
     OR NEW.year <> OLD.year
     OR NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id
     OR NEW.net_income_minor <> OLD.net_income_minor
     OR NEW.retained_earnings_account_id <> OLD.retained_earnings_account_id
     OR NEW.closed_at <> OLD.closed_at
     OR NEW.closed_by <> OLD.closed_by THEN
    RAISE EXCEPTION 'erp: a fiscal year close cannot be changed';
  END IF;

  IF OLD.reopened_at IS NOT NULL AND (
       NEW.reopened_at IS DISTINCT FROM OLD.reopened_at
       OR NEW.reopened_by IS DISTINCT FROM OLD.reopened_by
       OR NEW.reopen_reason IS DISTINCT FROM OLD.reopen_reason
       OR (OLD.reopen_journal_entry_id IS NOT NULL
           AND NEW.reopen_journal_entry_id IS DISTINCT FROM OLD.reopen_journal_entry_id)
     ) THEN
    RAISE EXCEPTION 'erp: a reopened fiscal year close cannot be changed';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "fiscal_year_closes_guard"
  BEFORE UPDATE OR DELETE ON "erp"."fiscal_year_closes"
  FOR EACH ROW
  EXECUTE FUNCTION "erp"."fiscal_year_closes_guard"();

-- The journal lifecycle guard (ADR-022), now also refusing a posting dated in a closed
-- fiscal year. The period row is locked FOR SHARE first; a year-end close locks every
-- period in the year FOR UPDATE, so a posting waits for a close and then sees it.
CREATE OR REPLACE FUNCTION "erp"."journal_entries_guard"()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
DECLARE
  -- The only columns a posted entry may change, and only while becoming REVERSED.
  reversal_columns constant text[] :=
    ARRAY['status', 'reversed_at', 'reversed_by', 'updated_at', 'updated_by'];
  period record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'erp: a journal entry is created as a draft and then posted';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'erp: a posted journal entry cannot be deleted; reverse it instead';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'REVERSED' THEN
    RAISE EXCEPTION 'erp: a reversed journal entry cannot be changed';
  END IF;

  IF OLD.status = 'POSTED' THEN
    IF NEW.status <> 'REVERSED'
       OR (to_jsonb(NEW) - reversal_columns) IS DISTINCT FROM (to_jsonb(OLD) - reversal_columns) THEN
      RAISE EXCEPTION 'erp: a posted journal entry cannot be changed; reverse it instead';
    END IF;
    RETURN NEW;
  END IF;

  -- OLD is a draft.
  IF NEW.status = 'REVERSED' THEN
    RAISE EXCEPTION 'erp: only a posted journal entry can be reversed';
  END IF;

  IF NEW.status = 'POSTED' THEN
    -- FOR SHARE: a concurrent close must wait for this posting to commit, and a
    -- posting must wait for a concurrent close, so neither slips past the other.
    SELECT p.status::text AS status, p.start_date, p.end_date INTO period
      FROM erp.fiscal_periods p WHERE p.id = NEW.fiscal_period_id
      FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'erp: a journal entry must be posted into an accounting period';
    END IF;
    IF period.status <> 'OPEN' THEN
      RAISE EXCEPTION 'erp: the accounting period is closed';
    END IF;
    IF NEW.entry_date < period.start_date OR NEW.entry_date > period.end_date THEN
      RAISE EXCEPTION 'erp: the entry date is outside the accounting period';
    END IF;
    IF EXISTS (
      SELECT 1 FROM erp.fiscal_year_closes c
       WHERE c.year = EXTRACT(YEAR FROM NEW.entry_date)::int
         AND c.reopened_at IS NULL
    ) THEN
      RAISE EXCEPTION 'erp: the fiscal year of this entry is closed; reopen the year first';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION "erp"."fiscal_year_closes_guard"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "erp"."journal_entries_guard"() FROM PUBLIC;

-- ===========================================================================
-- Row-level security deny-by-default (ADR-015) on the new table, and no grants
-- for the API roles.
-- ===========================================================================

DO $$
DECLARE
  target record;
BEGIN
  FOR target IN SELECT tablename FROM pg_tables WHERE schemaname = 'erp' LOOP
    EXECUTE format('ALTER TABLE erp.%I ENABLE ROW LEVEL SECURITY', target.tablename);
  END LOOP;
END $$;

DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA erp FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA erp FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA erp FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA erp FROM %I', api_role);
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA erp REVOKE ALL ON TABLES FROM %I', api_role
      );
    END IF;
  END LOOP;
END $$;
