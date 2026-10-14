-- CreateEnum
CREATE TYPE "committees"."CommitteeExpenseCategory" AS ENUM ('DINNER', 'TRANSPORTATION', 'VISA', 'LUNCH', 'COFFEE', 'OTHER');

-- CreateEnum
CREATE TYPE "committees"."CommitteeExpenseStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "committees"."CommitteeReceiptStatus" AS ENUM ('PENDING', 'READY');

-- CreateTable
CREATE TABLE "committees"."missions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "default_currency" CHAR(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "missions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "committees"."expense_receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "status" "committees"."CommitteeReceiptStatus" NOT NULL DEFAULT 'PENDING',
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "committees"."mission_expenses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mission_id" UUID NOT NULL,
    "submitted_by" UUID NOT NULL,
    "category" "committees"."CommitteeExpenseCategory" NOT NULL,
    "description" TEXT,
    "expense_date" DATE NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "receipt_id" UUID NOT NULL,
    "status" "committees"."CommitteeExpenseStatus" NOT NULL DEFAULT 'SUBMITTED',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "review_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mission_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "missions_is_active_name_idx" ON "committees"."missions"("is_active", "name");

-- CreateIndex
CREATE UNIQUE INDEX "expense_receipts_storage_key_key" ON "committees"."expense_receipts"("storage_key");

-- CreateIndex
CREATE INDEX "expense_receipts_uploaded_by_status_idx" ON "committees"."expense_receipts"("uploaded_by", "status");

-- CreateIndex
CREATE UNIQUE INDEX "mission_expenses_receipt_id_key" ON "committees"."mission_expenses"("receipt_id");

-- CreateIndex
CREATE INDEX "mission_expenses_mission_id_expense_date_idx" ON "committees"."mission_expenses"("mission_id", "expense_date");

-- CreateIndex
CREATE INDEX "mission_expenses_submitted_by_created_at_idx" ON "committees"."mission_expenses"("submitted_by", "created_at");

-- CreateIndex
CREATE INDEX "mission_expenses_status_created_at_idx" ON "committees"."mission_expenses"("status", "created_at");

-- CreateIndex
CREATE INDEX "mission_expenses_expense_date_idx" ON "committees"."mission_expenses"("expense_date");

-- AddForeignKey
ALTER TABLE "committees"."expense_receipts" ADD CONSTRAINT "expense_receipts_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "committees"."mission_expenses" ADD CONSTRAINT "mission_expenses_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "committees"."missions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "committees"."mission_expenses" ADD CONSTRAINT "mission_expenses_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "committees"."mission_expenses" ADD CONSTRAINT "mission_expenses_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "committees"."mission_expenses" ADD CONSTRAINT "mission_expenses_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "committees"."expense_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Invariants Prisma cannot express (ADR-037)
-- ---------------------------------------------------------------------------
ALTER TABLE "committees"."missions"
  ADD CONSTRAINT "missions_name_length"
    CHECK (char_length(btrim("name")) BETWEEN 1 AND 120),
  ADD CONSTRAINT "missions_description_length"
    CHECK ("description" IS NULL OR char_length("description") <= 2000),
  ADD CONSTRAINT "missions_default_currency_format"
    CHECK ("default_currency" ~ '^[A-Z]{3}$');

-- One mission per name, ignoring case and surrounding spaces.
CREATE UNIQUE INDEX "missions_name_key"
  ON "committees"."missions" (lower(btrim("name")));

-- Receipts are pictures: JPEG or PNG, verified by content, at most 10 MB.
ALTER TABLE "committees"."expense_receipts"
  ADD CONSTRAINT "expense_receipts_content_type"
    CHECK ("content_type" IN ('image/jpeg', 'image/png')),
  ADD CONSTRAINT "expense_receipts_size"
    CHECK ("size_bytes" BETWEEN 1 AND 10485760);

ALTER TABLE "committees"."mission_expenses"
  -- Above zero, and at most 10,000,000.00 in any supported (two-decimal) currency.
  ADD CONSTRAINT "mission_expenses_amount_positive"
    CHECK ("amount_minor" > 0 AND "amount_minor" <= 1000000000),
  ADD CONSTRAINT "mission_expenses_currency_format"
    CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "mission_expenses_date_range"
    CHECK ("expense_date" BETWEEN DATE '2000-01-01' AND DATE '2100-12-31'),
  ADD CONSTRAINT "mission_expenses_description_length"
    CHECK ("description" IS NULL OR char_length(btrim("description")) BETWEEN 1 AND 1000),
  -- "Other" must say what it was.
  ADD CONSTRAINT "mission_expenses_other_described"
    CHECK ("category" <> 'OTHER' OR "description" IS NOT NULL),
  -- Reviewed exactly when a reviewer and a review time are recorded.
  ADD CONSTRAINT "mission_expenses_review_recorded"
    CHECK (
      ("status" = 'SUBMITTED') = ("reviewed_by" IS NULL)
      AND ("status" = 'SUBMITTED') = ("reviewed_at" IS NULL)
    ),
  ADD CONSTRAINT "mission_expenses_review_note"
    CHECK (
      "review_note" IS NULL
      OR ("status" <> 'SUBMITTED' AND char_length(btrim("review_note")) BETWEEN 1 AND 1000)
    ),
  -- Nobody approves or rejects their own claim (CLAUDE.md §13.3).
  ADD CONSTRAINT "mission_expenses_no_self_review"
    CHECK ("reviewed_by" IS NULL OR "reviewed_by" <> "submitted_by");

-- ---------------------------------------------------------------------------
-- A claim is evidence: it is never edited, and it is reviewed once
-- ---------------------------------------------------------------------------
-- While SUBMITTED only the review may be recorded; once reviewed nothing changes;
-- and no expense is ever deleted. For every writer, the owner connection included.
-- TRUNCATE stays open for the integration suite's resets (ADR-015).
CREATE OR REPLACE FUNCTION "committees"."mission_expenses_guard"()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'committees: mission expenses are never deleted';
  END IF;
  IF OLD.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION 'committees: a reviewed mission expense cannot change';
  END IF;
  IF (NEW.mission_id, NEW.submitted_by, NEW.category, NEW.description, NEW.expense_date,
      NEW.amount_minor, NEW.currency, NEW.receipt_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.mission_id, OLD.submitted_by, OLD.category, OLD.description, OLD.expense_date,
      OLD.amount_minor, OLD.currency, OLD.receipt_id, OLD.created_at) THEN
    RAISE EXCEPTION 'committees: a submitted mission expense cannot be edited';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION "committees"."mission_expenses_guard"() FROM PUBLIC;

CREATE TRIGGER "mission_expenses_guard"
  BEFORE UPDATE OR DELETE ON "committees"."mission_expenses"
  FOR EACH ROW
  EXECUTE FUNCTION "committees"."mission_expenses_guard"();

-- ---------------------------------------------------------------------------
-- Row-level security: deny by default, no policies (ADR-015)
-- ---------------------------------------------------------------------------
ALTER TABLE "committees"."missions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "committees"."expense_receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "committees"."mission_expenses" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE committees.missions FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON TABLE committees.expense_receipts FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON TABLE committees.mission_expenses FROM %I', api_role);
    END IF;
  END LOOP;
END $$;
