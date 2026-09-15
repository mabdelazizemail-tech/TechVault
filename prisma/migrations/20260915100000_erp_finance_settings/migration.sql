-- CreateEnum
CREATE TYPE "erp"."ErpJournalKind" AS ENUM ('STANDARD', 'OPENING_BALANCE', 'YEAR_END_CLOSE');

-- AlterTable
ALTER TABLE "erp"."journal_entries" ADD COLUMN     "kind" "erp"."ErpJournalKind" NOT NULL DEFAULT 'STANDARD';

-- CreateTable
CREATE TABLE "erp"."finance_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "allow_self_posting" BOOLEAN NOT NULL DEFAULT false,
    "retained_earnings_account_id" UUID,
    "opening_balance_account_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "finance_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "journal_entries_kind_entry_date_idx" ON "erp"."journal_entries"("kind", "entry_date" DESC);

-- AddForeignKey
ALTER TABLE "erp"."finance_settings" ADD CONSTRAINT "finance_settings_retained_earnings_account_id_fkey" FOREIGN KEY ("retained_earnings_account_id") REFERENCES "erp"."accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."finance_settings" ADD CONSTRAINT "finance_settings_opening_balance_account_id_fkey" FOREIGN KEY ("opening_balance_account_id") REFERENCES "erp"."accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- Finance settings (ADR-027). Existing journal entries become STANDARD, which is
-- what they are. A posted entry's kind is frozen by journal_entries_guard, which
-- already refuses any change to a posted entry except becoming REVERSED.
-- ===========================================================================

ALTER TABLE "erp"."finance_settings"
  ADD CONSTRAINT "finance_settings_single_row" CHECK ("id" = 1);

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
