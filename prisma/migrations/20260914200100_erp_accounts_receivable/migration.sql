-- CreateEnum
CREATE TYPE "erp"."ErpArInvoiceStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "erp"."ErpArReceiptStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');




-- CreateTable
CREATE TABLE "erp"."ar_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "default_receivable_account_id" UUID,
    "invoice_approval_required" BOOLEAN NOT NULL DEFAULT true,
    "approval_threshold_minor" BIGINT,
    "allow_self_approval" BOOLEAN NOT NULL DEFAULT false,
    "default_payment_terms_days" INTEGER NOT NULL DEFAULT 30,
    "aging_bucket_days" INTEGER[] DEFAULT ARRAY[30, 60, 90, 120]::INTEGER[],
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "ar_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp"."number_series" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_type" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "padding" INTEGER NOT NULL DEFAULT 6,
    "resets_yearly" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "number_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp"."number_series_counters" (
    "series_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "number_series_counters_pkey" PRIMARY KEY ("series_id","year")
);

-- CreateTable
CREATE TABLE "erp"."tax_rates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_ar" TEXT,
    "rate_basis_points" INTEGER NOT NULL,
    "tax_account_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp"."payment_methods" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_ar" TEXT,
    "default_deposit_account_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp"."ar_customer_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "crm_account_id" UUID NOT NULL,
    "payment_terms_days" INTEGER,
    "credit_limit_minor" BIGINT,
    "receivable_account_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "ar_customer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp"."ar_invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_number" TEXT,
    "crm_account_id" UUID NOT NULL,
    "invoice_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EGP',
    "status" "erp"."ErpArInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal_minor" BIGINT NOT NULL DEFAULT 0,
    "discount_minor" BIGINT NOT NULL DEFAULT 0,
    "tax_minor" BIGINT NOT NULL DEFAULT 0,
    "total_minor" BIGINT NOT NULL DEFAULT 0,
    "paid_minor" BIGINT NOT NULL DEFAULT 0,
    "outstanding_minor" BIGINT NOT NULL DEFAULT 0,
    "reference" TEXT,
    "notes" TEXT,
    "receivable_account_id" UUID NOT NULL,
    "fiscal_period_id" UUID,
    "journal_entry_id" UUID,
    "void_journal_entry_id" UUID,
    "submitted_at" TIMESTAMPTZ(6),
    "submitted_by" UUID,
    "approval_skipped" BOOLEAN NOT NULL DEFAULT false,
    "approved_at" TIMESTAMPTZ(6),
    "approved_by" UUID,
    "rejected_at" TIMESTAMPTZ(6),
    "rejected_by" UUID,
    "rejection_reason" TEXT,
    "posted_at" TIMESTAMPTZ(6),
    "posted_by" UUID,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by" UUID,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "ar_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp"."ar_invoice_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit_price_minor" BIGINT NOT NULL,
    "gross_minor" BIGINT NOT NULL,
    "discount_minor" BIGINT NOT NULL DEFAULT 0,
    "net_minor" BIGINT NOT NULL,
    "tax_rate_id" UUID,
    "tax_rate_basis_points" INTEGER,
    "tax_minor" BIGINT NOT NULL DEFAULT 0,
    "total_minor" BIGINT NOT NULL,
    "revenue_account_id" UUID NOT NULL,
    "cost_centre_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ar_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp"."ar_receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "receipt_number" TEXT,
    "crm_account_id" UUID NOT NULL,
    "receipt_date" DATE NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EGP',
    "payment_method_id" UUID NOT NULL,
    "deposit_account_id" UUID NOT NULL,
    "receivable_account_id" UUID NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "status" "erp"."ErpArReceiptStatus" NOT NULL DEFAULT 'DRAFT',
    "allocated_minor" BIGINT NOT NULL DEFAULT 0,
    "fiscal_period_id" UUID,
    "journal_entry_id" UUID,
    "void_journal_entry_id" UUID,
    "posted_at" TIMESTAMPTZ(6),
    "posted_by" UUID,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by" UUID,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "ar_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp"."ar_receipt_allocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "receipt_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "ar_receipt_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "number_series_document_type_key" ON "erp"."number_series"("document_type");

-- CreateIndex
CREATE UNIQUE INDEX "tax_rates_code_key" ON "erp"."tax_rates"("code");

-- CreateIndex
CREATE INDEX "tax_rates_is_active_idx" ON "erp"."tax_rates"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "payment_methods_code_key" ON "erp"."payment_methods"("code");

-- CreateIndex
CREATE INDEX "payment_methods_is_active_sort_order_idx" ON "erp"."payment_methods"("is_active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "ar_customer_profiles_crm_account_id_key" ON "erp"."ar_customer_profiles"("crm_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "ar_invoices_invoice_number_key" ON "erp"."ar_invoices"("invoice_number");

-- CreateIndex
CREATE UNIQUE INDEX "ar_invoices_journal_entry_id_key" ON "erp"."ar_invoices"("journal_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "ar_invoices_void_journal_entry_id_key" ON "erp"."ar_invoices"("void_journal_entry_id");

-- CreateIndex
CREATE INDEX "ar_invoices_crm_account_id_status_idx" ON "erp"."ar_invoices"("crm_account_id", "status");

-- CreateIndex
CREATE INDEX "ar_invoices_status_invoice_date_idx" ON "erp"."ar_invoices"("status", "invoice_date" DESC);

-- CreateIndex
CREATE INDEX "ar_invoices_invoice_date_idx" ON "erp"."ar_invoices"("invoice_date" DESC);

-- CreateIndex
CREATE INDEX "ar_invoices_due_date_idx" ON "erp"."ar_invoices"("due_date");

-- CreateIndex
CREATE INDEX "ar_invoices_outstanding_minor_due_date_idx" ON "erp"."ar_invoices"("outstanding_minor", "due_date");

-- CreateIndex
CREATE INDEX "ar_invoices_fiscal_period_id_idx" ON "erp"."ar_invoices"("fiscal_period_id");

-- CreateIndex
CREATE INDEX "ar_invoices_created_by_idx" ON "erp"."ar_invoices"("created_by");

-- CreateIndex
CREATE INDEX "ar_invoice_lines_revenue_account_id_idx" ON "erp"."ar_invoice_lines"("revenue_account_id");

-- CreateIndex
CREATE INDEX "ar_invoice_lines_tax_rate_id_idx" ON "erp"."ar_invoice_lines"("tax_rate_id");

-- CreateIndex
CREATE INDEX "ar_invoice_lines_cost_centre_id_idx" ON "erp"."ar_invoice_lines"("cost_centre_id");

-- CreateIndex
CREATE UNIQUE INDEX "ar_invoice_lines_invoice_id_line_no_key" ON "erp"."ar_invoice_lines"("invoice_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "ar_receipts_receipt_number_key" ON "erp"."ar_receipts"("receipt_number");

-- CreateIndex
CREATE UNIQUE INDEX "ar_receipts_journal_entry_id_key" ON "erp"."ar_receipts"("journal_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "ar_receipts_void_journal_entry_id_key" ON "erp"."ar_receipts"("void_journal_entry_id");

-- CreateIndex
CREATE INDEX "ar_receipts_crm_account_id_status_idx" ON "erp"."ar_receipts"("crm_account_id", "status");

-- CreateIndex
CREATE INDEX "ar_receipts_status_receipt_date_idx" ON "erp"."ar_receipts"("status", "receipt_date" DESC);

-- CreateIndex
CREATE INDEX "ar_receipts_receipt_date_idx" ON "erp"."ar_receipts"("receipt_date" DESC);

-- CreateIndex
CREATE INDEX "ar_receipts_payment_method_id_idx" ON "erp"."ar_receipts"("payment_method_id");

-- CreateIndex
CREATE INDEX "ar_receipts_fiscal_period_id_idx" ON "erp"."ar_receipts"("fiscal_period_id");

-- CreateIndex
CREATE INDEX "ar_receipt_allocations_invoice_id_idx" ON "erp"."ar_receipt_allocations"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "ar_receipt_allocations_receipt_id_invoice_id_key" ON "erp"."ar_receipt_allocations"("receipt_id", "invoice_id");

-- AddForeignKey
ALTER TABLE "erp"."ar_settings" ADD CONSTRAINT "ar_settings_default_receivable_account_id_fkey" FOREIGN KEY ("default_receivable_account_id") REFERENCES "erp"."accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."number_series_counters" ADD CONSTRAINT "number_series_counters_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "erp"."number_series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."tax_rates" ADD CONSTRAINT "tax_rates_tax_account_id_fkey" FOREIGN KEY ("tax_account_id") REFERENCES "erp"."accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."payment_methods" ADD CONSTRAINT "payment_methods_default_deposit_account_id_fkey" FOREIGN KEY ("default_deposit_account_id") REFERENCES "erp"."accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ar_customer_profiles" ADD CONSTRAINT "ar_customer_profiles_receivable_account_id_fkey" FOREIGN KEY ("receivable_account_id") REFERENCES "erp"."accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ar_invoices" ADD CONSTRAINT "ar_invoices_receivable_account_id_fkey" FOREIGN KEY ("receivable_account_id") REFERENCES "erp"."accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ar_invoices" ADD CONSTRAINT "ar_invoices_fiscal_period_id_fkey" FOREIGN KEY ("fiscal_period_id") REFERENCES "erp"."fiscal_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ar_invoices" ADD CONSTRAINT "ar_invoices_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "erp"."journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ar_invoices" ADD CONSTRAINT "ar_invoices_void_journal_entry_id_fkey" FOREIGN KEY ("void_journal_entry_id") REFERENCES "erp"."journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ar_invoices" ADD CONSTRAINT "ar_invoices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ar_invoices" ADD CONSTRAINT "ar_invoices_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ar_invoices" ADD CONSTRAINT "ar_invoices_posted_by_fkey" FOREIGN KEY ("posted_by") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ar_invoice_lines" ADD CONSTRAINT "ar_invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "erp"."ar_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ar_invoice_lines" ADD CONSTRAINT "ar_invoice_lines_tax_rate_id_fkey" FOREIGN KEY ("tax_rate_id") REFERENCES "erp"."tax_rates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ar_invoice_lines" ADD CONSTRAINT "ar_invoice_lines_revenue_account_id_fkey" FOREIGN KEY ("revenue_account_id") REFERENCES "erp"."accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ar_invoice_lines" ADD CONSTRAINT "ar_invoice_lines_cost_centre_id_fkey" FOREIGN KEY ("cost_centre_id") REFERENCES "erp"."cost_centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ar_receipts" ADD CONSTRAINT "ar_receipts_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "erp"."payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ar_receipts" ADD CONSTRAINT "ar_receipts_deposit_account_id_fkey" FOREIGN KEY ("deposit_account_id") REFERENCES "erp"."accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ar_receipts" ADD CONSTRAINT "ar_receipts_receivable_account_id_fkey" FOREIGN KEY ("receivable_account_id") REFERENCES "erp"."accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ar_receipts" ADD CONSTRAINT "ar_receipts_fiscal_period_id_fkey" FOREIGN KEY ("fiscal_period_id") REFERENCES "erp"."fiscal_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ar_receipts" ADD CONSTRAINT "ar_receipts_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "erp"."journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ar_receipts" ADD CONSTRAINT "ar_receipts_void_journal_entry_id_fkey" FOREIGN KEY ("void_journal_entry_id") REFERENCES "erp"."journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ar_receipts" ADD CONSTRAINT "ar_receipts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ar_receipts" ADD CONSTRAINT "ar_receipts_posted_by_fkey" FOREIGN KEY ("posted_by") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ar_receipt_allocations" ADD CONSTRAINT "ar_receipt_allocations_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "erp"."ar_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ar_receipt_allocations" ADD CONSTRAINT "ar_receipt_allocations_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "erp"."ar_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- Accounts receivable invariants (ADR-023). Like the ledger's, they hold for
-- every writer, including the owner connection the application uses: an invoice
-- or receipt in the ledger is frozen, always matches its journal entry, and can
-- never be over-allocated.
-- ===========================================================================

-- A non-empty, strictly increasing list of positive day counts.
CREATE OR REPLACE FUNCTION "erp"."is_ascending_positive"(p_values integer[])
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path = ''
AS $$
  SELECT coalesce(bool_and(s.v > 0 AND (s.prev IS NULL OR s.v > s.prev)), false)
    FROM (
      SELECT t.v, lag(t.v) OVER (ORDER BY t.ord) AS prev
        FROM unnest(p_values) WITH ORDINALITY AS t(v, ord)
    ) s
$$;

-- ---------------------------------------------------------------------------
-- 1. Row-level CHECKs
-- ---------------------------------------------------------------------------

ALTER TABLE "erp"."ar_settings"
  ADD CONSTRAINT "ar_settings_single_row" CHECK ("id" = 1),
  ADD CONSTRAINT "ar_settings_threshold_non_negative"
    CHECK ("approval_threshold_minor" IS NULL OR "approval_threshold_minor" >= 0),
  ADD CONSTRAINT "ar_settings_terms_range" CHECK ("default_payment_terms_days" BETWEEN 0 AND 3650),
  ADD CONSTRAINT "ar_settings_aging_buckets" CHECK (
    cardinality("aging_bucket_days") BETWEEN 1 AND 8
    AND "erp"."is_ascending_positive"("aging_bucket_days")
  );

ALTER TABLE "erp"."number_series"
  ADD CONSTRAINT "number_series_document_type" CHECK ("document_type" IN ('AR_INVOICE', 'AR_RECEIPT')),
  ADD CONSTRAINT "number_series_prefix" CHECK ("prefix" ~ '^[A-Z0-9]{1,12}$'),
  ADD CONSTRAINT "number_series_padding" CHECK ("padding" BETWEEN 1 AND 12);

ALTER TABLE "erp"."number_series_counters"
  ADD CONSTRAINT "number_series_counters_year" CHECK ("year" = 0 OR "year" BETWEEN 1900 AND 9999),
  ADD CONSTRAINT "number_series_counters_non_negative" CHECK ("last_number" >= 0);

ALTER TABLE "erp"."tax_rates"
  ADD CONSTRAINT "tax_rates_code_not_blank" CHECK (btrim("code") <> ''),
  ADD CONSTRAINT "tax_rates_name_not_blank" CHECK (btrim("name") <> ''),
  ADD CONSTRAINT "tax_rates_rate_range" CHECK ("rate_basis_points" BETWEEN 0 AND 10000);

ALTER TABLE "erp"."payment_methods"
  ADD CONSTRAINT "payment_methods_code_not_blank" CHECK (btrim("code") <> ''),
  ADD CONSTRAINT "payment_methods_name_not_blank" CHECK (btrim("name") <> '');

ALTER TABLE "erp"."ar_customer_profiles"
  ADD CONSTRAINT "ar_customer_profiles_terms_range"
    CHECK ("payment_terms_days" IS NULL OR "payment_terms_days" BETWEEN 0 AND 3650),
  ADD CONSTRAINT "ar_customer_profiles_credit_limit"
    CHECK ("credit_limit_minor" IS NULL OR "credit_limit_minor" >= 0);

ALTER TABLE "erp"."ar_invoices"
  ADD CONSTRAINT "ar_invoices_currency" CHECK ("currency" = 'EGP'),
  ADD CONSTRAINT "ar_invoices_due_after_invoice" CHECK ("due_date" >= "invoice_date"),
  ADD CONSTRAINT "ar_invoices_amounts_non_negative" CHECK (
    "subtotal_minor" >= 0 AND "discount_minor" >= 0 AND "tax_minor" >= 0 AND "total_minor" >= 0
  ),
  ADD CONSTRAINT "ar_invoices_total_adds_up"
    CHECK ("total_minor" = "subtotal_minor" - "discount_minor" + "tax_minor"),
  ADD CONSTRAINT "ar_invoices_paid_range" CHECK ("paid_minor" >= 0 AND "paid_minor" <= "total_minor"),
  ADD CONSTRAINT "ar_invoices_outstanding" CHECK (
    "outstanding_minor" = CASE
      WHEN "status" IN ('POSTED', 'PARTIALLY_PAID', 'PAID') THEN "total_minor" - "paid_minor"
      ELSE 0
    END
  ),
  -- The payment status says exactly what the paid amount says.
  ADD CONSTRAINT "ar_invoices_payment_status" CHECK (
    ("status" = 'POSTED' AND "paid_minor" = 0)
    OR ("status" = 'PARTIALLY_PAID' AND "paid_minor" > 0 AND "paid_minor" < "total_minor")
    OR ("status" = 'PAID' AND "paid_minor" = "total_minor" AND "total_minor" > 0)
    OR ("status" IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'CANCELLED') AND "paid_minor" = 0)
  ),
  -- The lifecycle's bookkeeping columns match the status.
  ADD CONSTRAINT "ar_invoices_lifecycle" CHECK (
    ("status" = 'DRAFT'
      AND "invoice_number" IS NULL AND "journal_entry_id" IS NULL AND "fiscal_period_id" IS NULL
      AND "posted_at" IS NULL AND "approved_at" IS NULL AND "submitted_at" IS NULL
      AND "cancelled_at" IS NULL AND "void_journal_entry_id" IS NULL)
    OR ("status" = 'PENDING_APPROVAL'
      AND "submitted_at" IS NOT NULL AND "submitted_by" IS NOT NULL AND "approved_at" IS NULL
      AND "invoice_number" IS NULL AND "journal_entry_id" IS NULL AND "cancelled_at" IS NULL)
    OR ("status" = 'APPROVED'
      AND "submitted_at" IS NOT NULL AND "approved_at" IS NOT NULL
      AND ("approved_by" IS NOT NULL OR "approval_skipped")
      AND "invoice_number" IS NULL AND "journal_entry_id" IS NULL AND "cancelled_at" IS NULL)
    OR ("status" IN ('POSTED', 'PARTIALLY_PAID', 'PAID')
      AND "approved_at" IS NOT NULL AND "invoice_number" IS NOT NULL AND "journal_entry_id" IS NOT NULL
      AND "fiscal_period_id" IS NOT NULL AND "posted_at" IS NOT NULL AND "posted_by" IS NOT NULL
      AND "cancelled_at" IS NULL AND "void_journal_entry_id" IS NULL)
    OR ("status" = 'CANCELLED'
      AND "cancelled_at" IS NOT NULL AND "cancelled_by" IS NOT NULL AND "cancel_reason" IS NOT NULL
      AND (("journal_entry_id" IS NULL AND "void_journal_entry_id" IS NULL AND "invoice_number" IS NULL)
        OR ("journal_entry_id" IS NOT NULL AND "void_journal_entry_id" IS NOT NULL
          AND "invoice_number" IS NOT NULL)))
  );

ALTER TABLE "erp"."ar_invoice_lines"
  ADD CONSTRAINT "ar_invoice_lines_line_no_positive" CHECK ("line_no" >= 1),
  ADD CONSTRAINT "ar_invoice_lines_description_not_blank" CHECK (btrim("description") <> ''),
  ADD CONSTRAINT "ar_invoice_lines_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "ar_invoice_lines_price_non_negative" CHECK ("unit_price_minor" >= 0),
  -- Every stored figure re-derives from quantity, price, discount and rate, rounded
  -- half away from zero exactly as the services round.
  ADD CONSTRAINT "ar_invoice_lines_gross" CHECK ("gross_minor" = round("quantity" * "unit_price_minor")),
  ADD CONSTRAINT "ar_invoice_lines_discount_range"
    CHECK ("discount_minor" >= 0 AND "discount_minor" <= "gross_minor"),
  ADD CONSTRAINT "ar_invoice_lines_net" CHECK ("net_minor" = "gross_minor" - "discount_minor"),
  ADD CONSTRAINT "ar_invoice_lines_tax_rate_pair"
    CHECK (("tax_rate_id" IS NULL) = ("tax_rate_basis_points" IS NULL)),
  ADD CONSTRAINT "ar_invoice_lines_tax_rate_range"
    CHECK ("tax_rate_basis_points" IS NULL OR "tax_rate_basis_points" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "ar_invoice_lines_tax" CHECK (
    "tax_minor" = CASE
      WHEN "tax_rate_basis_points" IS NULL THEN 0
      ELSE round("net_minor"::numeric * "tax_rate_basis_points" / 10000)
    END
  ),
  ADD CONSTRAINT "ar_invoice_lines_total" CHECK ("total_minor" = "net_minor" + "tax_minor");

ALTER TABLE "erp"."ar_receipts"
  ADD CONSTRAINT "ar_receipts_currency" CHECK ("currency" = 'EGP'),
  ADD CONSTRAINT "ar_receipts_amount_positive" CHECK ("amount_minor" > 0),
  ADD CONSTRAINT "ar_receipts_allocated_range"
    CHECK ("allocated_minor" >= 0 AND "allocated_minor" <= "amount_minor"),
  ADD CONSTRAINT "ar_receipts_lifecycle" CHECK (
    ("status" = 'DRAFT'
      AND "receipt_number" IS NULL AND "journal_entry_id" IS NULL AND "fiscal_period_id" IS NULL
      AND "posted_at" IS NULL AND "allocated_minor" = 0 AND "cancelled_at" IS NULL
      AND "void_journal_entry_id" IS NULL)
    OR ("status" = 'POSTED'
      AND "receipt_number" IS NOT NULL AND "journal_entry_id" IS NOT NULL AND "fiscal_period_id" IS NOT NULL
      AND "posted_at" IS NOT NULL AND "posted_by" IS NOT NULL AND "cancelled_at" IS NULL
      AND "void_journal_entry_id" IS NULL)
    OR ("status" = 'CANCELLED'
      AND "cancelled_at" IS NOT NULL AND "cancelled_by" IS NOT NULL AND "cancel_reason" IS NOT NULL
      AND "allocated_minor" = 0
      AND (("journal_entry_id" IS NULL AND "void_journal_entry_id" IS NULL)
        OR ("journal_entry_id" IS NOT NULL AND "void_journal_entry_id" IS NOT NULL)))
  );

ALTER TABLE "erp"."ar_receipt_allocations"
  ADD CONSTRAINT "ar_receipt_allocations_amount_positive" CHECK ("amount_minor" > 0);

-- ---------------------------------------------------------------------------
-- 2. Lifecycle guards: created as drafts; frozen once in the ledger, except for
--    what allocations and voiding may change; never deleted once submitted.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "erp"."ar_invoices_guard"()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
DECLARE
  payment_columns constant text[] :=
    ARRAY['status', 'paid_minor', 'outstanding_minor', 'updated_at', 'updated_by'];
  void_columns constant text[] :=
    ARRAY['status', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'void_journal_entry_id',
          'outstanding_minor', 'updated_at', 'updated_by'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'erp: an invoice is created as a draft';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'erp: only a draft invoice can be deleted; cancel it instead';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'erp: a cancelled invoice cannot be changed';
  END IF;

  IF OLD.status IN ('POSTED', 'PARTIALLY_PAID', 'PAID') THEN
    IF NEW.status IN ('POSTED', 'PARTIALLY_PAID', 'PAID') THEN
      IF (to_jsonb(NEW) - payment_columns) IS DISTINCT FROM (to_jsonb(OLD) - payment_columns) THEN
        RAISE EXCEPTION 'erp: a posted invoice cannot be changed; void it instead';
      END IF;
    ELSIF NEW.status = 'CANCELLED' THEN
      IF OLD.paid_minor <> 0
         OR (to_jsonb(NEW) - void_columns) IS DISTINCT FROM (to_jsonb(OLD) - void_columns) THEN
        RAISE EXCEPTION 'erp: only an unpaid posted invoice can be voided';
      END IF;
    ELSE
      RAISE EXCEPTION 'erp: a posted invoice cannot return to an earlier status';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IN ('POSTED', 'PARTIALLY_PAID', 'PAID') AND OLD.status <> 'APPROVED' THEN
    RAISE EXCEPTION 'erp: only an approved invoice can be posted';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ar_invoices_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "erp"."ar_invoices"
  FOR EACH ROW
  EXECUTE FUNCTION "erp"."ar_invoices_guard"();

CREATE OR REPLACE FUNCTION "erp"."ar_invoice_lines_guard"()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
DECLARE
  invoice_status text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.invoice_id <> OLD.invoice_id THEN
    RAISE EXCEPTION 'erp: an invoice line cannot move to another invoice';
  END IF;

  SELECT i.status::text INTO invoice_status
    FROM erp.ar_invoices i
   WHERE i.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;

  -- No invoice row means a draft is being deleted and its lines cascade with it.
  IF invoice_status IS NOT NULL AND invoice_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'erp: the lines of a submitted or posted invoice cannot be changed';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER "ar_invoice_lines_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "erp"."ar_invoice_lines"
  FOR EACH ROW
  EXECUTE FUNCTION "erp"."ar_invoice_lines_guard"();

CREATE OR REPLACE FUNCTION "erp"."ar_receipts_guard"()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
DECLARE
  allocation_columns constant text[] := ARRAY['allocated_minor', 'updated_at', 'updated_by'];
  void_columns constant text[] :=
    ARRAY['status', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'void_journal_entry_id',
          'updated_at', 'updated_by'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'erp: a receipt is created as a draft';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'erp: only a draft receipt can be deleted; cancel it instead';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'erp: a cancelled receipt cannot be changed';
  END IF;

  IF OLD.status = 'POSTED' THEN
    IF NEW.status = 'POSTED' THEN
      IF (to_jsonb(NEW) - allocation_columns) IS DISTINCT FROM (to_jsonb(OLD) - allocation_columns) THEN
        RAISE EXCEPTION 'erp: a posted receipt cannot be changed; void it instead';
      END IF;
    ELSIF NEW.status = 'CANCELLED' THEN
      IF OLD.allocated_minor <> 0
         OR (to_jsonb(NEW) - void_columns) IS DISTINCT FROM (to_jsonb(OLD) - void_columns) THEN
        RAISE EXCEPTION 'erp: only an unallocated posted receipt can be voided';
      END IF;
    ELSE
      RAISE EXCEPTION 'erp: a posted receipt cannot return to draft';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ar_receipts_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "erp"."ar_receipts"
  FOR EACH ROW
  EXECUTE FUNCTION "erp"."ar_receipts_guard"();

-- ---------------------------------------------------------------------------
-- 3. Allocations: validated, applied to the invoice and the receipt, and refused
--    when they would exceed either — under row locks, so two people allocating at
--    once queue rather than over-allocate.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "erp"."ar_receipt_allocations_apply"()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
DECLARE
  target_receipt uuid;
  target_invoice uuid;
  receipt record;
  invoice record;
  delta bigint;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.receipt_id <> OLD.receipt_id OR NEW.invoice_id <> OLD.invoice_id) THEN
    RAISE EXCEPTION 'erp: an allocation cannot move to another receipt or invoice';
  END IF;

  target_receipt := CASE WHEN TG_OP = 'DELETE' THEN OLD.receipt_id ELSE NEW.receipt_id END;
  target_invoice := CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;

  -- Receipt first, then invoice — the same order everywhere, so concurrent work
  -- queues instead of deadlocking.
  SELECT r.status::text AS status, r.crm_account_id, r.currency, r.receivable_account_id,
         r.amount_minor, r.allocated_minor
    INTO receipt
    FROM erp.ar_receipts r WHERE r.id = target_receipt
    FOR UPDATE;
  SELECT i.status::text AS status, i.crm_account_id, i.currency, i.receivable_account_id,
         i.total_minor, i.paid_minor
    INTO invoice
    FROM erp.ar_invoices i WHERE i.id = target_invoice
    FOR UPDATE;

  IF receipt.status IS DISTINCT FROM 'POSTED' THEN
    RAISE EXCEPTION 'erp: only a posted receipt can be allocated';
  END IF;
  IF TG_OP <> 'DELETE' THEN
    IF invoice.status IS NULL OR invoice.status NOT IN ('POSTED', 'PARTIALLY_PAID', 'PAID') THEN
      RAISE EXCEPTION 'erp: a receipt can only be allocated to a posted invoice';
    END IF;
    IF invoice.crm_account_id <> receipt.crm_account_id THEN
      RAISE EXCEPTION 'erp: a receipt can only be allocated to invoices of the same customer';
    END IF;
    IF invoice.currency <> receipt.currency THEN
      RAISE EXCEPTION 'erp: a receipt can only be allocated to invoices in its currency';
    END IF;
    IF invoice.receivable_account_id <> receipt.receivable_account_id THEN
      RAISE EXCEPTION 'erp: the receipt and the invoice use different receivable accounts';
    END IF;
  END IF;

  delta := CASE TG_OP
    WHEN 'INSERT' THEN NEW.amount_minor
    WHEN 'UPDATE' THEN NEW.amount_minor - OLD.amount_minor
    ELSE -OLD.amount_minor
  END;

  IF receipt.allocated_minor + delta > receipt.amount_minor THEN
    RAISE EXCEPTION 'erp: the allocation is more than the unallocated amount of the receipt';
  END IF;
  IF invoice.paid_minor + delta > invoice.total_minor THEN
    RAISE EXCEPTION 'erp: the allocation is more than the outstanding amount of the invoice';
  END IF;

  UPDATE erp.ar_receipts
     SET allocated_minor = allocated_minor + delta, updated_at = now()
   WHERE id = target_receipt;
  UPDATE erp.ar_invoices
     SET paid_minor = paid_minor + delta,
         outstanding_minor = total_minor - (paid_minor + delta),
         status = (CASE
           WHEN paid_minor + delta = 0 THEN 'POSTED'
           WHEN paid_minor + delta >= total_minor THEN 'PAID'
           ELSE 'PARTIALLY_PAID'
         END)::"erp"."ErpArInvoiceStatus",
         updated_at = now()
   WHERE id = target_invoice;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER "ar_receipt_allocations_apply"
  BEFORE INSERT OR UPDATE OR DELETE ON "erp"."ar_receipt_allocations"
  FOR EACH ROW
  EXECUTE FUNCTION "erp"."ar_receipt_allocations_apply"();

-- ---------------------------------------------------------------------------
-- 4. At COMMIT: an invoice's totals equal its lines, its paid amount equals its
--    allocations, and an invoice or receipt in the ledger matches its posted
--    journal entry (or, voided, its reversed entry and posted void). A journal
--    entry raised by an invoice or receipt is reversed only by voiding that document.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "erp"."ar_check_invoice"(p_invoice_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
DECLARE
  invoice record;
  sums record;
  allocated bigint;
  journal record;
  reversal record;
BEGIN
  SELECT i.id, i.status::text AS status, i.subtotal_minor, i.discount_minor, i.tax_minor,
         i.total_minor, i.paid_minor, i.invoice_date, i.journal_entry_id, i.void_journal_entry_id
    INTO invoice
    FROM erp.ar_invoices i WHERE i.id = p_invoice_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT count(*) AS line_count, coalesce(sum(l.gross_minor), 0) AS gross,
         coalesce(sum(l.discount_minor), 0) AS discount, coalesce(sum(l.tax_minor), 0) AS tax,
         coalesce(sum(l.total_minor), 0) AS total
    INTO sums
    FROM erp.ar_invoice_lines l WHERE l.invoice_id = p_invoice_id;

  IF invoice.subtotal_minor <> sums.gross OR invoice.discount_minor <> sums.discount
     OR invoice.tax_minor <> sums.tax OR invoice.total_minor <> sums.total THEN
    RAISE EXCEPTION 'erp: the invoice totals do not match its lines';
  END IF;

  SELECT coalesce(sum(a.amount_minor), 0) INTO allocated
    FROM erp.ar_receipt_allocations a WHERE a.invoice_id = p_invoice_id;
  IF invoice.paid_minor <> allocated THEN
    RAISE EXCEPTION 'erp: the amount paid on the invoice does not match its allocations';
  END IF;

  IF invoice.status IN ('PENDING_APPROVAL', 'APPROVED', 'POSTED', 'PARTIALLY_PAID', 'PAID')
     AND (sums.line_count = 0 OR invoice.total_minor <= 0) THEN
    RAISE EXCEPTION 'erp: a submitted invoice needs at least one line and a total above zero';
  END IF;

  IF invoice.journal_entry_id IS NOT NULL THEN
    SELECT e.status::text AS status, e.source_module, e.source_type, e.source_id,
           e.total_minor, e.entry_date
      INTO journal
      FROM erp.journal_entries e WHERE e.id = invoice.journal_entry_id;
    IF journal.source_module IS DISTINCT FROM 'erp'
       OR journal.source_type IS DISTINCT FROM 'ar_invoice'
       OR journal.source_id IS DISTINCT FROM invoice.id::text THEN
      RAISE EXCEPTION 'erp: the invoice journal entry belongs to another document';
    END IF;
    IF journal.total_minor <> invoice.total_minor OR journal.entry_date <> invoice.invoice_date THEN
      RAISE EXCEPTION 'erp: the invoice journal entry does not match the invoice';
    END IF;
    IF invoice.status IN ('POSTED', 'PARTIALLY_PAID', 'PAID') AND journal.status <> 'POSTED' THEN
      RAISE EXCEPTION 'erp: a posted invoice needs its posted journal entry';
    END IF;
    IF invoice.status = 'CANCELLED' THEN
      SELECT v.status::text AS status, v.reverses_entry_id INTO reversal
        FROM erp.journal_entries v WHERE v.id = invoice.void_journal_entry_id;
      IF journal.status <> 'REVERSED' OR reversal.status IS DISTINCT FROM 'POSTED'
         OR reversal.reverses_entry_id IS DISTINCT FROM invoice.journal_entry_id THEN
        RAISE EXCEPTION 'erp: a voided invoice needs its journal entry reversed by its void entry';
      END IF;
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "erp"."ar_invoices_check"()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
  PERFORM erp.ar_check_invoice(NEW.id);
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "ar_invoices_check"
  AFTER INSERT OR UPDATE ON "erp"."ar_invoices"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION "erp"."ar_invoices_check"();

CREATE OR REPLACE FUNCTION "erp"."ar_invoice_lines_check"()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
  PERFORM erp.ar_check_invoice(CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END);
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "ar_invoice_lines_check"
  AFTER INSERT OR UPDATE OR DELETE ON "erp"."ar_invoice_lines"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION "erp"."ar_invoice_lines_check"();

CREATE OR REPLACE FUNCTION "erp"."ar_receipts_check"()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
DECLARE
  receipt record;
  allocated bigint;
  journal record;
  reversal record;
BEGIN
  SELECT r.id, r.status::text AS status, r.amount_minor, r.allocated_minor, r.receipt_date,
         r.journal_entry_id, r.void_journal_entry_id
    INTO receipt
    FROM erp.ar_receipts r WHERE r.id = NEW.id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(sum(a.amount_minor), 0) INTO allocated
    FROM erp.ar_receipt_allocations a WHERE a.receipt_id = NEW.id;
  IF receipt.allocated_minor <> allocated THEN
    RAISE EXCEPTION 'erp: the allocated amount of the receipt does not match its allocations';
  END IF;

  IF receipt.journal_entry_id IS NOT NULL THEN
    SELECT e.status::text AS status, e.source_module, e.source_type, e.source_id,
           e.total_minor, e.entry_date
      INTO journal
      FROM erp.journal_entries e WHERE e.id = receipt.journal_entry_id;
    IF journal.source_module IS DISTINCT FROM 'erp'
       OR journal.source_type IS DISTINCT FROM 'ar_receipt'
       OR journal.source_id IS DISTINCT FROM receipt.id::text THEN
      RAISE EXCEPTION 'erp: the receipt journal entry belongs to another document';
    END IF;
    IF journal.total_minor <> receipt.amount_minor OR journal.entry_date <> receipt.receipt_date THEN
      RAISE EXCEPTION 'erp: the receipt journal entry does not match the receipt';
    END IF;
    IF receipt.status = 'POSTED' AND journal.status <> 'POSTED' THEN
      RAISE EXCEPTION 'erp: a posted receipt needs its posted journal entry';
    END IF;
    IF receipt.status = 'CANCELLED' THEN
      SELECT v.status::text AS status, v.reverses_entry_id INTO reversal
        FROM erp.journal_entries v WHERE v.id = receipt.void_journal_entry_id;
      IF journal.status <> 'REVERSED' OR reversal.status IS DISTINCT FROM 'POSTED'
         OR reversal.reverses_entry_id IS DISTINCT FROM receipt.journal_entry_id THEN
        RAISE EXCEPTION 'erp: a voided receipt needs its journal entry reversed by its void entry';
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "ar_receipts_check"
  AFTER INSERT OR UPDATE ON "erp"."ar_receipts"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION "erp"."ar_receipts_check"();

CREATE OR REPLACE FUNCTION "erp"."journal_entries_source_check"()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
  IF NEW.status::text = 'REVERSED' AND NEW.source_type = 'ar_invoice' AND NOT EXISTS (
    SELECT 1 FROM erp.ar_invoices i WHERE i.journal_entry_id = NEW.id AND i.status = 'CANCELLED'
  ) THEN
    RAISE EXCEPTION 'erp: the journal entry of an invoice is reversed only by voiding the invoice';
  END IF;
  IF NEW.status::text = 'REVERSED' AND NEW.source_type = 'ar_receipt' AND NOT EXISTS (
    SELECT 1 FROM erp.ar_receipts r WHERE r.journal_entry_id = NEW.id AND r.status = 'CANCELLED'
  ) THEN
    RAISE EXCEPTION 'erp: the journal entry of a receipt is reversed only by voiding the receipt';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "journal_entries_source_check"
  AFTER UPDATE ON "erp"."journal_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION "erp"."journal_entries_source_check"();

REVOKE ALL ON FUNCTION "erp"."is_ascending_positive"(integer[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION "erp"."ar_invoices_guard"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "erp"."ar_invoice_lines_guard"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "erp"."ar_receipts_guard"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "erp"."ar_receipt_allocations_apply"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "erp"."ar_check_invoice"(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION "erp"."ar_invoices_check"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "erp"."ar_invoice_lines_check"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "erp"."ar_receipts_check"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "erp"."journal_entries_source_check"() FROM PUBLIC;

-- ===========================================================================
-- Row-level security deny-by-default (ADR-015) on the new tables, and no grants
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
