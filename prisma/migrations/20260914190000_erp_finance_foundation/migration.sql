-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "erp";

-- CreateEnum
CREATE TYPE "erp"."ErpAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "erp"."ErpNormalBalance" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "erp"."ErpPeriodStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "erp"."ErpJournalStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED');

-- CreateTable
CREATE TABLE "erp"."accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_ar" TEXT,
    "type" "erp"."ErpAccountType" NOT NULL,
    "normal_balance" "erp"."ErpNormalBalance" NOT NULL,
    "parent_id" UUID,
    "is_postable" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp"."cost_centres" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_ar" TEXT,
    "parent_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "cost_centres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp"."fiscal_periods" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "erp"."ErpPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMPTZ(6),
    "closed_by" UUID,
    "reopened_at" TIMESTAMPTZ(6),
    "reopened_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "fiscal_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp"."journal_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "journal_number" TEXT,
    "entry_date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "status" "erp"."ErpJournalStatus" NOT NULL DEFAULT 'DRAFT',
    "fiscal_period_id" UUID,
    "total_minor" BIGINT NOT NULL DEFAULT 0,
    "source_module" TEXT,
    "source_type" TEXT,
    "source_id" TEXT,
    "posted_at" TIMESTAMPTZ(6),
    "posted_by" UUID,
    "reverses_entry_id" UUID,
    "reversed_at" TIMESTAMPTZ(6),
    "reversed_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp"."journal_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "journal_entry_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "account_id" UUID NOT NULL,
    "cost_centre_id" UUID,
    "description" TEXT,
    "debit_minor" BIGINT NOT NULL DEFAULT 0,
    "credit_minor" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp"."journal_sequences" (
    "year" INTEGER NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_sequences_pkey" PRIMARY KEY ("year")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_code_key" ON "erp"."accounts"("code");

-- CreateIndex
CREATE INDEX "accounts_parent_id_idx" ON "erp"."accounts"("parent_id");

-- CreateIndex
CREATE INDEX "accounts_type_code_idx" ON "erp"."accounts"("type", "code");

-- CreateIndex
CREATE INDEX "accounts_is_active_idx" ON "erp"."accounts"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "cost_centres_code_key" ON "erp"."cost_centres"("code");

-- CreateIndex
CREATE INDEX "cost_centres_parent_id_idx" ON "erp"."cost_centres"("parent_id");

-- CreateIndex
CREATE INDEX "cost_centres_is_active_idx" ON "erp"."cost_centres"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_periods_name_key" ON "erp"."fiscal_periods"("name");

-- CreateIndex
CREATE INDEX "fiscal_periods_start_date_idx" ON "erp"."fiscal_periods"("start_date");

-- CreateIndex
CREATE INDEX "fiscal_periods_status_idx" ON "erp"."fiscal_periods"("status");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_journal_number_key" ON "erp"."journal_entries"("journal_number");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_reverses_entry_id_key" ON "erp"."journal_entries"("reverses_entry_id");

-- CreateIndex
CREATE INDEX "journal_entries_status_entry_date_idx" ON "erp"."journal_entries"("status", "entry_date" DESC);

-- CreateIndex
CREATE INDEX "journal_entries_entry_date_idx" ON "erp"."journal_entries"("entry_date" DESC);

-- CreateIndex
CREATE INDEX "journal_entries_fiscal_period_id_idx" ON "erp"."journal_entries"("fiscal_period_id");

-- CreateIndex
CREATE INDEX "journal_entries_source_module_source_type_source_id_idx" ON "erp"."journal_entries"("source_module", "source_type", "source_id");

-- CreateIndex
CREATE INDEX "journal_entries_created_by_idx" ON "erp"."journal_entries"("created_by");

-- CreateIndex
CREATE INDEX "journal_lines_account_id_idx" ON "erp"."journal_lines"("account_id");

-- CreateIndex
CREATE INDEX "journal_lines_cost_centre_id_idx" ON "erp"."journal_lines"("cost_centre_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_lines_journal_entry_id_line_no_key" ON "erp"."journal_lines"("journal_entry_id", "line_no");

-- AddForeignKey
ALTER TABLE "erp"."accounts" ADD CONSTRAINT "accounts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "erp"."accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."cost_centres" ADD CONSTRAINT "cost_centres_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "erp"."cost_centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."fiscal_periods" ADD CONSTRAINT "fiscal_periods_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."fiscal_periods" ADD CONSTRAINT "fiscal_periods_reopened_by_fkey" FOREIGN KEY ("reopened_by") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."journal_entries" ADD CONSTRAINT "journal_entries_fiscal_period_id_fkey" FOREIGN KEY ("fiscal_period_id") REFERENCES "erp"."fiscal_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."journal_entries" ADD CONSTRAINT "journal_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."journal_entries" ADD CONSTRAINT "journal_entries_posted_by_fkey" FOREIGN KEY ("posted_by") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."journal_entries" ADD CONSTRAINT "journal_entries_reversed_by_fkey" FOREIGN KEY ("reversed_by") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."journal_entries" ADD CONSTRAINT "journal_entries_reverses_entry_id_fkey" FOREIGN KEY ("reverses_entry_id") REFERENCES "erp"."journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."journal_lines" ADD CONSTRAINT "journal_lines_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "erp"."journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."journal_lines" ADD CONSTRAINT "journal_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "erp"."accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."journal_lines" ADD CONSTRAINT "journal_lines_cost_centre_id_fkey" FOREIGN KEY ("cost_centre_id") REFERENCES "erp"."cost_centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- ERP finance invariants (ADR-022). Everything below holds for every writer,
-- including the owner connection the application uses: a service bug cannot
-- post an unbalanced entry, post into a closed period, or rewrite history.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Row-level CHECKs
-- ---------------------------------------------------------------------------

ALTER TABLE "erp"."accounts"
  ADD CONSTRAINT "accounts_code_not_blank" CHECK (btrim("code") <> ''),
  ADD CONSTRAINT "accounts_name_not_blank" CHECK (btrim("name") <> ''),
  ADD CONSTRAINT "accounts_not_own_parent" CHECK ("parent_id" IS NULL OR "parent_id" <> "id");

ALTER TABLE "erp"."cost_centres"
  ADD CONSTRAINT "cost_centres_code_not_blank" CHECK (btrim("code") <> ''),
  ADD CONSTRAINT "cost_centres_name_not_blank" CHECK (btrim("name") <> ''),
  ADD CONSTRAINT "cost_centres_not_own_parent" CHECK ("parent_id" IS NULL OR "parent_id" <> "id");

ALTER TABLE "erp"."fiscal_periods"
  ADD CONSTRAINT "fiscal_periods_name_not_blank" CHECK (btrim("name") <> ''),
  ADD CONSTRAINT "fiscal_periods_dates_ordered" CHECK ("start_date" <= "end_date"),
  -- A closed period records who closed it and when; an open one carries neither.
  ADD CONSTRAINT "fiscal_periods_close_details" CHECK (
    ("status" = 'OPEN' AND "closed_at" IS NULL AND "closed_by" IS NULL)
    OR ("status" = 'CLOSED' AND "closed_at" IS NOT NULL AND "closed_by" IS NOT NULL)
  ),
  -- Two periods never share a day. A range exclusion needs no extension.
  ADD CONSTRAINT "fiscal_periods_no_overlap"
    EXCLUDE USING gist (daterange("start_date", "end_date", '[]') WITH &&);

ALTER TABLE "erp"."journal_entries"
  ADD CONSTRAINT "journal_entries_description_not_blank" CHECK (btrim("description") <> ''),
  ADD CONSTRAINT "journal_entries_total_non_negative" CHECK ("total_minor" >= 0),
  ADD CONSTRAINT "journal_entries_not_own_reversal"
    CHECK ("reverses_entry_id" IS NULL OR "reverses_entry_id" <> "id"),
  ADD CONSTRAINT "journal_entries_source_complete"
    CHECK (num_nulls("source_module", "source_type", "source_id") IN (0, 3)),
  -- The lifecycle's bookkeeping columns match the status exactly.
  ADD CONSTRAINT "journal_entries_lifecycle" CHECK (
    ("status" = 'DRAFT'
      AND "journal_number" IS NULL AND "posted_at" IS NULL AND "posted_by" IS NULL
      AND "fiscal_period_id" IS NULL AND "reversed_at" IS NULL AND "reversed_by" IS NULL)
    OR ("status" = 'POSTED'
      AND "journal_number" IS NOT NULL AND "posted_at" IS NOT NULL AND "posted_by" IS NOT NULL
      AND "fiscal_period_id" IS NOT NULL AND "reversed_at" IS NULL AND "reversed_by" IS NULL)
    OR ("status" = 'REVERSED'
      AND "journal_number" IS NOT NULL AND "posted_at" IS NOT NULL AND "posted_by" IS NOT NULL
      AND "fiscal_period_id" IS NOT NULL AND "reversed_at" IS NOT NULL AND "reversed_by" IS NOT NULL)
  );

ALTER TABLE "erp"."journal_lines"
  ADD CONSTRAINT "journal_lines_line_no_positive" CHECK ("line_no" >= 1),
  ADD CONSTRAINT "journal_lines_amounts_non_negative"
    CHECK ("debit_minor" >= 0 AND "credit_minor" >= 0),
  -- A line is a debit or a credit, never both and never neither.
  ADD CONSTRAINT "journal_lines_one_side" CHECK (
    ("debit_minor" > 0 AND "credit_minor" = 0) OR ("credit_minor" > 0 AND "debit_minor" = 0)
  );

ALTER TABLE "erp"."journal_sequences"
  ADD CONSTRAINT "journal_sequences_year_range" CHECK ("year" BETWEEN 1900 AND 9999),
  ADD CONSTRAINT "journal_sequences_non_negative" CHECK ("last_number" >= 0);

-- ---------------------------------------------------------------------------
-- 2. The chart of accounts is a consistent tree
-- ---------------------------------------------------------------------------
-- A child has its parent's type, a parent is a heading, no account is its own
-- ancestor, and an account that already carries postings keeps its type and stays
-- postable — changing either would silently restate every report it appears in.
CREATE OR REPLACE FUNCTION "erp"."accounts_guard"()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
DECLARE
  parent record;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    SELECT a.type::text AS type, a.is_postable INTO parent
      FROM erp.accounts a WHERE a.id = NEW.parent_id;
    IF parent.type IS DISTINCT FROM NEW.type::text THEN
      RAISE EXCEPTION 'erp: an account must have the same type as its parent';
    END IF;
    IF parent.is_postable THEN
      RAISE EXCEPTION 'erp: a parent account must be a heading, not a postable account';
    END IF;
    IF TG_OP = 'UPDATE' AND EXISTS (
      WITH RECURSIVE ancestors(id, parent_id) AS (
        SELECT a.id, a.parent_id FROM erp.accounts a WHERE a.id = NEW.parent_id
        UNION
        SELECT a.id, a.parent_id FROM erp.accounts a JOIN ancestors x ON a.id = x.parent_id
      )
      SELECT 1 FROM ancestors WHERE ancestors.id = NEW.id
    ) THEN
      RAISE EXCEPTION 'erp: an account cannot be placed under one of its own sub-accounts';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.type IS DISTINCT FROM OLD.type THEN
      IF EXISTS (SELECT 1 FROM erp.accounts c WHERE c.parent_id = NEW.id) THEN
        RAISE EXCEPTION 'erp: the type of an account with sub-accounts cannot change';
      END IF;
      IF EXISTS (SELECT 1 FROM erp.journal_lines l WHERE l.account_id = NEW.id) THEN
        RAISE EXCEPTION 'erp: the type of an account used in journal entries cannot change';
      END IF;
    END IF;
    IF NEW.is_postable AND NOT OLD.is_postable
       AND EXISTS (SELECT 1 FROM erp.accounts c WHERE c.parent_id = NEW.id) THEN
      RAISE EXCEPTION 'erp: an account with sub-accounts must stay a heading';
    END IF;
    IF OLD.is_postable AND NOT NEW.is_postable
       AND EXISTS (SELECT 1 FROM erp.journal_lines l WHERE l.account_id = NEW.id) THEN
      RAISE EXCEPTION 'erp: an account used in journal entries cannot become a heading';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "accounts_guard"
  BEFORE INSERT OR UPDATE ON "erp"."accounts"
  FOR EACH ROW
  EXECUTE FUNCTION "erp"."accounts_guard"();

CREATE OR REPLACE FUNCTION "erp"."cost_centres_guard"()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.parent_id IS NOT NULL AND EXISTS (
    WITH RECURSIVE ancestors(id, parent_id) AS (
      SELECT c.id, c.parent_id FROM erp.cost_centres c WHERE c.id = NEW.parent_id
      UNION
      SELECT c.id, c.parent_id FROM erp.cost_centres c JOIN ancestors x ON c.id = x.parent_id
    )
    SELECT 1 FROM ancestors WHERE ancestors.id = NEW.id
  ) THEN
    RAISE EXCEPTION 'erp: a cost centre cannot be placed under one of its own sub-centres';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "cost_centres_guard"
  BEFORE UPDATE ON "erp"."cost_centres"
  FOR EACH ROW
  EXECUTE FUNCTION "erp"."cost_centres_guard"();

-- ---------------------------------------------------------------------------
-- 3. Periods: the dates of a period holding postings are fixed
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "erp"."fiscal_periods_guard"()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
  IF (NEW.start_date, NEW.end_date) IS DISTINCT FROM (OLD.start_date, OLD.end_date)
     AND EXISTS (SELECT 1 FROM erp.journal_entries e WHERE e.fiscal_period_id = OLD.id) THEN
    RAISE EXCEPTION 'erp: the dates of a period that holds posted entries cannot change';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "fiscal_periods_guard"
  BEFORE UPDATE ON "erp"."fiscal_periods"
  FOR EACH ROW
  EXECUTE FUNCTION "erp"."fiscal_periods_guard"();

-- ---------------------------------------------------------------------------
-- 4. The journal lifecycle: created as a draft, posted into an open period, then
--    immutable except for being marked reversed. Never deleted once posted.
-- ---------------------------------------------------------------------------
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
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "journal_entries_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "erp"."journal_entries"
  FOR EACH ROW
  EXECUTE FUNCTION "erp"."journal_entries_guard"();

-- Lines belong to a draft. Once the entry is posted they are frozen.
CREATE OR REPLACE FUNCTION "erp"."journal_lines_guard"()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
DECLARE
  entry_status text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.journal_entry_id <> OLD.journal_entry_id THEN
    RAISE EXCEPTION 'erp: a journal line cannot move to another entry';
  END IF;

  SELECT e.status::text INTO entry_status
    FROM erp.journal_entries e
   WHERE e.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.journal_entry_id ELSE NEW.journal_entry_id END;

  -- No entry row means a draft is being deleted and its lines cascade with it; the
  -- entry's own guard has already refused that for anything but a draft.
  IF entry_status IS NOT NULL AND entry_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'erp: the lines of a posted journal entry cannot be changed';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER "journal_lines_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "erp"."journal_lines"
  FOR EACH ROW
  EXECUTE FUNCTION "erp"."journal_lines_guard"();

-- ---------------------------------------------------------------------------
-- 5. Double entry, checked at COMMIT (deferred), once the entry and all of its
--    lines are in place: a posted entry has at least two lines, debits equal
--    credits and are above zero, the stored total matches, and — at the moment
--    of posting — every account is active and postable and every cost centre
--    active. A reversed entry has its posted reversal; a reversal is never a draft.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "erp"."journal_entries_check"()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
DECLARE
  entry record;
  line_count integer;
  debit_total numeric;
  credit_total numeric;
BEGIN
  -- Re-read the row as it stands at commit, not as it was when the event fired.
  SELECT e.status::text AS status, e.total_minor, e.reverses_entry_id INTO entry
    FROM erp.journal_entries e WHERE e.id = NEW.id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF entry.status = 'DRAFT' THEN
    IF entry.reverses_entry_id IS NOT NULL THEN
      RAISE EXCEPTION 'erp: a reversal must be posted in the same transaction that creates it';
    END IF;
    RETURN NULL;
  END IF;

  SELECT count(*), coalesce(sum(l.debit_minor), 0), coalesce(sum(l.credit_minor), 0)
    INTO line_count, debit_total, credit_total
    FROM erp.journal_lines l WHERE l.journal_entry_id = NEW.id;

  IF line_count < 2 THEN
    RAISE EXCEPTION 'erp: a posted journal entry needs at least two lines';
  END IF;
  IF debit_total <> credit_total THEN
    RAISE EXCEPTION 'erp: a posted journal entry must balance: total debits must equal total credits';
  END IF;
  IF debit_total = 0 THEN
    RAISE EXCEPTION 'erp: a posted journal entry cannot have a zero total';
  END IF;
  IF entry.total_minor <> debit_total THEN
    RAISE EXCEPTION 'erp: the journal entry total does not match its lines';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'DRAFT' AND entry.status = 'POSTED' THEN
    IF EXISTS (
      SELECT 1 FROM erp.journal_lines l
        JOIN erp.accounts a ON a.id = l.account_id
       WHERE l.journal_entry_id = NEW.id AND (NOT a.is_active OR NOT a.is_postable)
    ) THEN
      RAISE EXCEPTION 'erp: every account on a posted entry must be active and postable';
    END IF;
    IF EXISTS (
      SELECT 1 FROM erp.journal_lines l
        JOIN erp.cost_centres c ON c.id = l.cost_centre_id
       WHERE l.journal_entry_id = NEW.id AND NOT c.is_active
    ) THEN
      RAISE EXCEPTION 'erp: every cost centre on a posted entry must be active';
    END IF;
  END IF;

  IF entry.status = 'REVERSED' AND NOT EXISTS (
    SELECT 1 FROM erp.journal_entries r
     WHERE r.reverses_entry_id = NEW.id AND r.status = 'POSTED'
  ) THEN
    RAISE EXCEPTION 'erp: a reversed journal entry must have a posted reversal';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "journal_entries_check"
  AFTER INSERT OR UPDATE ON "erp"."journal_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION "erp"."journal_entries_check"();

REVOKE ALL ON FUNCTION "erp"."accounts_guard"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "erp"."cost_centres_guard"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "erp"."fiscal_periods_guard"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "erp"."journal_entries_guard"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "erp"."journal_lines_guard"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "erp"."journal_entries_check"() FROM PUBLIC;

-- ===========================================================================
-- Row-level security deny-by-default (ADR-015): tables get RLS in the migration
-- that creates them. The app connects as the table owner and is unaffected.
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
