-- CreateEnum
CREATE TYPE "erp"."ErpApBillStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "erp"."ErpApPaymentStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "erp"."tax_rates" ADD COLUMN     "input_tax_account_id" UUID;

-- CreateTable
CREATE TABLE "erp"."ap_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "default_payable_account_id" UUID,
    "bill_approval_required" BOOLEAN NOT NULL DEFAULT true,
    "bill_approval_threshold_minor" BIGINT,
    "payment_approval_required" BOOLEAN NOT NULL DEFAULT true,
    "payment_approval_threshold_minor" BIGINT,
    "allow_self_approval" BOOLEAN NOT NULL DEFAULT false,
    "default_payment_terms_days" INTEGER NOT NULL DEFAULT 30,
    "aging_bucket_days" INTEGER[] DEFAULT ARRAY[30, 60, 90, 120]::INTEGER[],
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "ap_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp"."withholding_tax_rates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_ar" TEXT,
    "rate_basis_points" INTEGER NOT NULL,
    "payable_account_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "withholding_tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp"."vendors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "name_ar" TEXT,
    "tax_registration_number" TEXT,
    "crm_account_id" UUID,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "payment_terms_days" INTEGER,
    "payable_account_id" UUID,
    "default_expense_account_id" UUID,
    "default_withholding_tax_rate_id" UUID,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp"."ap_bills" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bill_number" TEXT,
    "vendor_id" UUID NOT NULL,
    "vendor_invoice_number" TEXT NOT NULL,
    "bill_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EGP',
    "status" "erp"."ErpApBillStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal_minor" BIGINT NOT NULL DEFAULT 0,
    "discount_minor" BIGINT NOT NULL DEFAULT 0,
    "tax_minor" BIGINT NOT NULL DEFAULT 0,
    "total_minor" BIGINT NOT NULL DEFAULT 0,
    "paid_minor" BIGINT NOT NULL DEFAULT 0,
    "outstanding_minor" BIGINT NOT NULL DEFAULT 0,
    "reference" TEXT,
    "notes" TEXT,
    "payable_account_id" UUID NOT NULL,
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

    CONSTRAINT "ap_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp"."ap_bill_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bill_id" UUID NOT NULL,
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
    "expense_account_id" UUID NOT NULL,
    "cost_centre_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ap_bill_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp"."ap_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_number" TEXT,
    "vendor_id" UUID NOT NULL,
    "payment_date" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EGP',
    "status" "erp"."ErpApPaymentStatus" NOT NULL DEFAULT 'DRAFT',
    "amount_minor" BIGINT NOT NULL DEFAULT 0,
    "withheld_minor" BIGINT NOT NULL DEFAULT 0,
    "cash_minor" BIGINT NOT NULL DEFAULT 0,
    "payment_method_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "payable_account_id" UUID NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
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

    CONSTRAINT "ap_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp"."ap_payment_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "bill_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "withholding_tax_rate_id" UUID,
    "withholding_basis_points" INTEGER,
    "withholding_base_minor" BIGINT NOT NULL DEFAULT 0,
    "withheld_minor" BIGINT NOT NULL DEFAULT 0,
    "cash_minor" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ap_payment_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "withholding_tax_rates_code_key" ON "erp"."withholding_tax_rates"("code");

-- CreateIndex
CREATE INDEX "withholding_tax_rates_is_active_idx" ON "erp"."withholding_tax_rates"("is_active");

-- CreateIndex
CREATE INDEX "vendors_is_active_name_idx" ON "erp"."vendors"("is_active", "name");

-- CreateIndex
CREATE INDEX "vendors_crm_account_id_idx" ON "erp"."vendors"("crm_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "ap_bills_bill_number_key" ON "erp"."ap_bills"("bill_number");

-- CreateIndex
CREATE UNIQUE INDEX "ap_bills_journal_entry_id_key" ON "erp"."ap_bills"("journal_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "ap_bills_void_journal_entry_id_key" ON "erp"."ap_bills"("void_journal_entry_id");

-- CreateIndex
CREATE INDEX "ap_bills_vendor_id_status_idx" ON "erp"."ap_bills"("vendor_id", "status");

-- CreateIndex
CREATE INDEX "ap_bills_status_bill_date_idx" ON "erp"."ap_bills"("status", "bill_date" DESC);

-- CreateIndex
CREATE INDEX "ap_bills_bill_date_idx" ON "erp"."ap_bills"("bill_date" DESC);

-- CreateIndex
CREATE INDEX "ap_bills_due_date_idx" ON "erp"."ap_bills"("due_date");

-- CreateIndex
CREATE INDEX "ap_bills_outstanding_minor_due_date_idx" ON "erp"."ap_bills"("outstanding_minor", "due_date");

-- CreateIndex
CREATE INDEX "ap_bills_fiscal_period_id_idx" ON "erp"."ap_bills"("fiscal_period_id");

-- CreateIndex
CREATE INDEX "ap_bills_created_by_idx" ON "erp"."ap_bills"("created_by");

-- CreateIndex
CREATE INDEX "ap_bill_lines_expense_account_id_idx" ON "erp"."ap_bill_lines"("expense_account_id");

-- CreateIndex
CREATE INDEX "ap_bill_lines_tax_rate_id_idx" ON "erp"."ap_bill_lines"("tax_rate_id");

-- CreateIndex
CREATE INDEX "ap_bill_lines_cost_centre_id_idx" ON "erp"."ap_bill_lines"("cost_centre_id");

-- CreateIndex
CREATE UNIQUE INDEX "ap_bill_lines_bill_id_line_no_key" ON "erp"."ap_bill_lines"("bill_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "ap_payments_payment_number_key" ON "erp"."ap_payments"("payment_number");

-- CreateIndex
CREATE UNIQUE INDEX "ap_payments_journal_entry_id_key" ON "erp"."ap_payments"("journal_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "ap_payments_void_journal_entry_id_key" ON "erp"."ap_payments"("void_journal_entry_id");

-- CreateIndex
CREATE INDEX "ap_payments_vendor_id_status_idx" ON "erp"."ap_payments"("vendor_id", "status");

-- CreateIndex
CREATE INDEX "ap_payments_status_payment_date_idx" ON "erp"."ap_payments"("status", "payment_date" DESC);

-- CreateIndex
CREATE INDEX "ap_payments_payment_date_idx" ON "erp"."ap_payments"("payment_date" DESC);

-- CreateIndex
CREATE INDEX "ap_payments_payment_method_id_idx" ON "erp"."ap_payments"("payment_method_id");

-- CreateIndex
CREATE INDEX "ap_payments_fiscal_period_id_idx" ON "erp"."ap_payments"("fiscal_period_id");

-- CreateIndex
CREATE INDEX "ap_payments_created_by_idx" ON "erp"."ap_payments"("created_by");

-- CreateIndex
CREATE INDEX "ap_payment_lines_bill_id_idx" ON "erp"."ap_payment_lines"("bill_id");

-- CreateIndex
CREATE INDEX "ap_payment_lines_withholding_tax_rate_id_idx" ON "erp"."ap_payment_lines"("withholding_tax_rate_id");

-- CreateIndex
CREATE UNIQUE INDEX "ap_payment_lines_payment_id_line_no_key" ON "erp"."ap_payment_lines"("payment_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "ap_payment_lines_payment_id_bill_id_key" ON "erp"."ap_payment_lines"("payment_id", "bill_id");

-- AddForeignKey
ALTER TABLE "erp"."tax_rates" ADD CONSTRAINT "tax_rates_input_tax_account_id_fkey" FOREIGN KEY ("input_tax_account_id") REFERENCES "erp"."accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ap_settings" ADD CONSTRAINT "ap_settings_default_payable_account_id_fkey" FOREIGN KEY ("default_payable_account_id") REFERENCES "erp"."accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."withholding_tax_rates" ADD CONSTRAINT "withholding_tax_rates_payable_account_id_fkey" FOREIGN KEY ("payable_account_id") REFERENCES "erp"."accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."vendors" ADD CONSTRAINT "vendors_payable_account_id_fkey" FOREIGN KEY ("payable_account_id") REFERENCES "erp"."accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."vendors" ADD CONSTRAINT "vendors_default_expense_account_id_fkey" FOREIGN KEY ("default_expense_account_id") REFERENCES "erp"."accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."vendors" ADD CONSTRAINT "vendors_default_withholding_tax_rate_id_fkey" FOREIGN KEY ("default_withholding_tax_rate_id") REFERENCES "erp"."withholding_tax_rates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ap_bills" ADD CONSTRAINT "ap_bills_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "erp"."vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ap_bills" ADD CONSTRAINT "ap_bills_payable_account_id_fkey" FOREIGN KEY ("payable_account_id") REFERENCES "erp"."accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ap_bills" ADD CONSTRAINT "ap_bills_fiscal_period_id_fkey" FOREIGN KEY ("fiscal_period_id") REFERENCES "erp"."fiscal_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ap_bills" ADD CONSTRAINT "ap_bills_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "erp"."journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ap_bills" ADD CONSTRAINT "ap_bills_void_journal_entry_id_fkey" FOREIGN KEY ("void_journal_entry_id") REFERENCES "erp"."journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ap_bills" ADD CONSTRAINT "ap_bills_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ap_bills" ADD CONSTRAINT "ap_bills_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ap_bills" ADD CONSTRAINT "ap_bills_posted_by_fkey" FOREIGN KEY ("posted_by") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ap_bill_lines" ADD CONSTRAINT "ap_bill_lines_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "erp"."ap_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ap_bill_lines" ADD CONSTRAINT "ap_bill_lines_tax_rate_id_fkey" FOREIGN KEY ("tax_rate_id") REFERENCES "erp"."tax_rates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ap_bill_lines" ADD CONSTRAINT "ap_bill_lines_expense_account_id_fkey" FOREIGN KEY ("expense_account_id") REFERENCES "erp"."accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ap_bill_lines" ADD CONSTRAINT "ap_bill_lines_cost_centre_id_fkey" FOREIGN KEY ("cost_centre_id") REFERENCES "erp"."cost_centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ap_payments" ADD CONSTRAINT "ap_payments_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "erp"."vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ap_payments" ADD CONSTRAINT "ap_payments_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "erp"."payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ap_payments" ADD CONSTRAINT "ap_payments_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "erp"."accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ap_payments" ADD CONSTRAINT "ap_payments_payable_account_id_fkey" FOREIGN KEY ("payable_account_id") REFERENCES "erp"."accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ap_payments" ADD CONSTRAINT "ap_payments_fiscal_period_id_fkey" FOREIGN KEY ("fiscal_period_id") REFERENCES "erp"."fiscal_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ap_payments" ADD CONSTRAINT "ap_payments_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "erp"."journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ap_payments" ADD CONSTRAINT "ap_payments_void_journal_entry_id_fkey" FOREIGN KEY ("void_journal_entry_id") REFERENCES "erp"."journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ap_payments" ADD CONSTRAINT "ap_payments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ap_payments" ADD CONSTRAINT "ap_payments_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ap_payments" ADD CONSTRAINT "ap_payments_posted_by_fkey" FOREIGN KEY ("posted_by") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ap_payment_lines" ADD CONSTRAINT "ap_payment_lines_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "erp"."ap_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ap_payment_lines" ADD CONSTRAINT "ap_payment_lines_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "erp"."ap_bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ap_payment_lines" ADD CONSTRAINT "ap_payment_lines_withholding_tax_rate_id_fkey" FOREIGN KEY ("withholding_tax_rate_id") REFERENCES "erp"."withholding_tax_rates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ===========================================================================
-- Accounts payable invariants (ADR-033). Like receivables', they hold for every
-- writer, including the owner connection the application uses: a bill or payment
-- in the ledger is frozen and matches its journal entry, a bill is never paid past
-- its total, and every withholding figure re-derives from its rate.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Row-level CHECKs and unique indexes
-- ---------------------------------------------------------------------------

ALTER TABLE "erp"."ap_settings"
  ADD CONSTRAINT "ap_settings_single_row" CHECK ("id" = 1),
  ADD CONSTRAINT "ap_settings_bill_threshold_non_negative"
    CHECK ("bill_approval_threshold_minor" IS NULL OR "bill_approval_threshold_minor" >= 0),
  ADD CONSTRAINT "ap_settings_payment_threshold_non_negative"
    CHECK ("payment_approval_threshold_minor" IS NULL OR "payment_approval_threshold_minor" >= 0),
  ADD CONSTRAINT "ap_settings_terms_range" CHECK ("default_payment_terms_days" BETWEEN 0 AND 3650),
  ADD CONSTRAINT "ap_settings_aging_buckets" CHECK (
    cardinality("aging_bucket_days") BETWEEN 1 AND 8
    AND "erp"."is_ascending_positive"("aging_bucket_days")
  );

ALTER TABLE "erp"."withholding_tax_rates"
  ADD CONSTRAINT "withholding_tax_rates_code_not_blank" CHECK (btrim("code") <> ''),
  ADD CONSTRAINT "withholding_tax_rates_name_not_blank" CHECK (btrim("name") <> ''),
  ADD CONSTRAINT "withholding_tax_rates_rate_range" CHECK ("rate_basis_points" BETWEEN 1 AND 10000);

ALTER TABLE "erp"."vendors"
  ADD CONSTRAINT "vendors_name_not_blank" CHECK (btrim("name") <> ''),
  ADD CONSTRAINT "vendors_terms_range"
    CHECK ("payment_terms_days" IS NULL OR "payment_terms_days" BETWEEN 0 AND 3650),
  ADD CONSTRAINT "vendors_tax_registration_not_blank"
    CHECK ("tax_registration_number" IS NULL OR btrim("tax_registration_number") <> '');

-- One vendor per name and per tax registration number, whatever the case or spacing.
CREATE UNIQUE INDEX "vendors_name_unique" ON "erp"."vendors" (lower(btrim("name")));
CREATE UNIQUE INDEX "vendors_tax_registration_unique"
  ON "erp"."vendors" (upper(btrim("tax_registration_number")))
  WHERE "tax_registration_number" IS NOT NULL;

-- The same supplier invoice cannot be entered twice for one vendor; a cancelled bill
-- frees its number so it can be re-entered correctly.
CREATE UNIQUE INDEX "ap_bills_vendor_invoice_unique"
  ON "erp"."ap_bills" ("vendor_id", lower(btrim("vendor_invoice_number")))
  WHERE "status" <> 'CANCELLED';

ALTER TABLE "erp"."ap_bills"
  ADD CONSTRAINT "ap_bills_currency" CHECK ("currency" = 'EGP'),
  ADD CONSTRAINT "ap_bills_vendor_invoice_not_blank" CHECK (btrim("vendor_invoice_number") <> ''),
  ADD CONSTRAINT "ap_bills_due_after_bill" CHECK ("due_date" >= "bill_date"),
  ADD CONSTRAINT "ap_bills_amounts_non_negative" CHECK (
    "subtotal_minor" >= 0 AND "discount_minor" >= 0 AND "tax_minor" >= 0 AND "total_minor" >= 0
  ),
  ADD CONSTRAINT "ap_bills_total_adds_up"
    CHECK ("total_minor" = "subtotal_minor" - "discount_minor" + "tax_minor"),
  ADD CONSTRAINT "ap_bills_paid_range" CHECK ("paid_minor" >= 0 AND "paid_minor" <= "total_minor"),
  ADD CONSTRAINT "ap_bills_outstanding" CHECK (
    "outstanding_minor" = CASE
      WHEN "status" IN ('POSTED', 'PARTIALLY_PAID', 'PAID') THEN "total_minor" - "paid_minor"
      ELSE 0
    END
  ),
  ADD CONSTRAINT "ap_bills_payment_status" CHECK (
    ("status" = 'POSTED' AND "paid_minor" = 0)
    OR ("status" = 'PARTIALLY_PAID' AND "paid_minor" > 0 AND "paid_minor" < "total_minor")
    OR ("status" = 'PAID' AND "paid_minor" = "total_minor" AND "total_minor" > 0)
    OR ("status" IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'CANCELLED') AND "paid_minor" = 0)
  ),
  ADD CONSTRAINT "ap_bills_lifecycle" CHECK (
    ("status" = 'DRAFT'
      AND "bill_number" IS NULL AND "journal_entry_id" IS NULL AND "fiscal_period_id" IS NULL
      AND "posted_at" IS NULL AND "approved_at" IS NULL AND "submitted_at" IS NULL
      AND "cancelled_at" IS NULL AND "void_journal_entry_id" IS NULL)
    OR ("status" = 'PENDING_APPROVAL'
      AND "submitted_at" IS NOT NULL AND "submitted_by" IS NOT NULL AND "approved_at" IS NULL
      AND "bill_number" IS NULL AND "journal_entry_id" IS NULL AND "cancelled_at" IS NULL)
    OR ("status" = 'APPROVED'
      AND "submitted_at" IS NOT NULL AND "approved_at" IS NOT NULL
      AND ("approved_by" IS NOT NULL OR "approval_skipped")
      AND "bill_number" IS NULL AND "journal_entry_id" IS NULL AND "cancelled_at" IS NULL)
    OR ("status" IN ('POSTED', 'PARTIALLY_PAID', 'PAID')
      AND "approved_at" IS NOT NULL AND "bill_number" IS NOT NULL AND "journal_entry_id" IS NOT NULL
      AND "fiscal_period_id" IS NOT NULL AND "posted_at" IS NOT NULL AND "posted_by" IS NOT NULL
      AND "cancelled_at" IS NULL AND "void_journal_entry_id" IS NULL)
    OR ("status" = 'CANCELLED'
      AND "cancelled_at" IS NOT NULL AND "cancelled_by" IS NOT NULL AND "cancel_reason" IS NOT NULL
      AND (("journal_entry_id" IS NULL AND "void_journal_entry_id" IS NULL AND "bill_number" IS NULL)
        OR ("journal_entry_id" IS NOT NULL AND "void_journal_entry_id" IS NOT NULL
          AND "bill_number" IS NOT NULL)))
  );

ALTER TABLE "erp"."ap_bill_lines"
  ADD CONSTRAINT "ap_bill_lines_line_no_positive" CHECK ("line_no" >= 1),
  ADD CONSTRAINT "ap_bill_lines_description_not_blank" CHECK (btrim("description") <> ''),
  ADD CONSTRAINT "ap_bill_lines_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "ap_bill_lines_price_non_negative" CHECK ("unit_price_minor" >= 0),
  -- Every stored figure re-derives from quantity, price, discount and rate, rounded
  -- half away from zero exactly as the services round.
  ADD CONSTRAINT "ap_bill_lines_gross" CHECK ("gross_minor" = round("quantity" * "unit_price_minor")),
  ADD CONSTRAINT "ap_bill_lines_discount_range"
    CHECK ("discount_minor" >= 0 AND "discount_minor" <= "gross_minor"),
  ADD CONSTRAINT "ap_bill_lines_net" CHECK ("net_minor" = "gross_minor" - "discount_minor"),
  ADD CONSTRAINT "ap_bill_lines_tax_rate_pair"
    CHECK (("tax_rate_id" IS NULL) = ("tax_rate_basis_points" IS NULL)),
  ADD CONSTRAINT "ap_bill_lines_tax_rate_range"
    CHECK ("tax_rate_basis_points" IS NULL OR "tax_rate_basis_points" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "ap_bill_lines_tax" CHECK (
    "tax_minor" = CASE
      WHEN "tax_rate_basis_points" IS NULL THEN 0
      ELSE round("net_minor"::numeric * "tax_rate_basis_points" / 10000)
    END
  ),
  ADD CONSTRAINT "ap_bill_lines_total" CHECK ("total_minor" = "net_minor" + "tax_minor");

ALTER TABLE "erp"."ap_payments"
  ADD CONSTRAINT "ap_payments_currency" CHECK ("currency" = 'EGP'),
  ADD CONSTRAINT "ap_payments_amounts_non_negative"
    CHECK ("amount_minor" >= 0 AND "withheld_minor" >= 0 AND "cash_minor" >= 0),
  ADD CONSTRAINT "ap_payments_cash_adds_up" CHECK ("cash_minor" = "amount_minor" - "withheld_minor"),
  ADD CONSTRAINT "ap_payments_lifecycle" CHECK (
    ("status" = 'DRAFT'
      AND "payment_number" IS NULL AND "journal_entry_id" IS NULL AND "fiscal_period_id" IS NULL
      AND "posted_at" IS NULL AND "approved_at" IS NULL AND "submitted_at" IS NULL
      AND "cancelled_at" IS NULL AND "void_journal_entry_id" IS NULL)
    OR ("status" = 'PENDING_APPROVAL'
      AND "submitted_at" IS NOT NULL AND "submitted_by" IS NOT NULL AND "approved_at" IS NULL
      AND "payment_number" IS NULL AND "journal_entry_id" IS NULL AND "cancelled_at" IS NULL)
    OR ("status" = 'APPROVED'
      AND "submitted_at" IS NOT NULL AND "approved_at" IS NOT NULL
      AND ("approved_by" IS NOT NULL OR "approval_skipped")
      AND "payment_number" IS NULL AND "journal_entry_id" IS NULL AND "cancelled_at" IS NULL)
    OR ("status" = 'POSTED'
      AND "approved_at" IS NOT NULL AND "payment_number" IS NOT NULL AND "journal_entry_id" IS NOT NULL
      AND "fiscal_period_id" IS NOT NULL AND "posted_at" IS NOT NULL AND "posted_by" IS NOT NULL
      AND "cancelled_at" IS NULL AND "void_journal_entry_id" IS NULL)
    OR ("status" = 'CANCELLED'
      AND "cancelled_at" IS NOT NULL AND "cancelled_by" IS NOT NULL AND "cancel_reason" IS NOT NULL
      AND (("journal_entry_id" IS NULL AND "void_journal_entry_id" IS NULL AND "payment_number" IS NULL)
        OR ("journal_entry_id" IS NOT NULL AND "void_journal_entry_id" IS NOT NULL
          AND "payment_number" IS NOT NULL)))
  );

ALTER TABLE "erp"."ap_payment_lines"
  ADD CONSTRAINT "ap_payment_lines_line_no_positive" CHECK ("line_no" >= 1),
  ADD CONSTRAINT "ap_payment_lines_amount_positive" CHECK ("amount_minor" > 0),
  ADD CONSTRAINT "ap_payment_lines_rate_pair"
    CHECK (("withholding_tax_rate_id" IS NULL) = ("withholding_basis_points" IS NULL)),
  ADD CONSTRAINT "ap_payment_lines_rate_range"
    CHECK ("withholding_basis_points" IS NULL OR "withholding_basis_points" BETWEEN 1 AND 10000),
  ADD CONSTRAINT "ap_payment_lines_base_range"
    CHECK ("withholding_base_minor" >= 0 AND "withholding_base_minor" <= "amount_minor"),
  ADD CONSTRAINT "ap_payment_lines_withheld" CHECK (
    ("withholding_basis_points" IS NULL AND "withholding_base_minor" = 0 AND "withheld_minor" = 0)
    OR ("withholding_basis_points" IS NOT NULL
      AND "withheld_minor" = round("withholding_base_minor"::numeric * "withholding_basis_points" / 10000))
  ),
  ADD CONSTRAINT "ap_payment_lines_cash" CHECK ("cash_minor" = "amount_minor" - "withheld_minor");

-- ---------------------------------------------------------------------------
-- 2. Lifecycle guards: created as drafts; frozen once in the ledger except for what
--    payments and voiding may change; lines change only on a draft.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "erp"."ap_bills_guard"()
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
      RAISE EXCEPTION 'erp: a bill is created as a draft';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'erp: only a draft bill can be deleted; cancel it instead';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'erp: a cancelled bill cannot be changed';
  END IF;

  IF OLD.status IN ('POSTED', 'PARTIALLY_PAID', 'PAID') THEN
    IF NEW.status IN ('POSTED', 'PARTIALLY_PAID', 'PAID') THEN
      IF (to_jsonb(NEW) - payment_columns) IS DISTINCT FROM (to_jsonb(OLD) - payment_columns) THEN
        RAISE EXCEPTION 'erp: a posted bill cannot be changed; void it instead';
      END IF;
    ELSIF NEW.status = 'CANCELLED' THEN
      IF OLD.paid_minor <> 0
         OR (to_jsonb(NEW) - void_columns) IS DISTINCT FROM (to_jsonb(OLD) - void_columns) THEN
        RAISE EXCEPTION 'erp: only an unpaid posted bill can be voided';
      END IF;
    ELSE
      RAISE EXCEPTION 'erp: a posted bill cannot return to an earlier status';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IN ('POSTED', 'PARTIALLY_PAID', 'PAID') AND OLD.status <> 'APPROVED' THEN
    RAISE EXCEPTION 'erp: only an approved bill can be posted';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ap_bills_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "erp"."ap_bills"
  FOR EACH ROW
  EXECUTE FUNCTION "erp"."ap_bills_guard"();

CREATE OR REPLACE FUNCTION "erp"."ap_bill_lines_guard"()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
DECLARE
  bill_status text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.bill_id <> OLD.bill_id THEN
    RAISE EXCEPTION 'erp: a bill line cannot move to another bill';
  END IF;

  SELECT b.status::text INTO bill_status
    FROM erp.ap_bills b
   WHERE b.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.bill_id ELSE NEW.bill_id END;

  -- No bill row means a draft is being deleted and its lines cascade with it.
  IF bill_status IS NOT NULL AND bill_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'erp: the lines of a submitted or posted bill cannot be changed';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER "ap_bill_lines_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "erp"."ap_bill_lines"
  FOR EACH ROW
  EXECUTE FUNCTION "erp"."ap_bill_lines_guard"();

CREATE OR REPLACE FUNCTION "erp"."ap_payments_guard"()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
DECLARE
  void_columns constant text[] :=
    ARRAY['status', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'void_journal_entry_id',
          'updated_at', 'updated_by'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'erp: a payment is created as a draft';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'erp: only a draft payment can be deleted; cancel it instead';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'erp: a cancelled payment cannot be changed';
  END IF;

  IF OLD.status = 'POSTED' THEN
    IF NEW.status <> 'CANCELLED'
       OR (to_jsonb(NEW) - void_columns) IS DISTINCT FROM (to_jsonb(OLD) - void_columns) THEN
      RAISE EXCEPTION 'erp: a posted payment cannot be changed; void it instead';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'POSTED' AND OLD.status <> 'APPROVED' THEN
    RAISE EXCEPTION 'erp: only an approved payment can be posted';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ap_payments_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "erp"."ap_payments"
  FOR EACH ROW
  EXECUTE FUNCTION "erp"."ap_payments_guard"();

CREATE OR REPLACE FUNCTION "erp"."ap_payment_lines_guard"()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
DECLARE
  payment_status text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.payment_id <> OLD.payment_id THEN
    RAISE EXCEPTION 'erp: a payment line cannot move to another payment';
  END IF;

  SELECT p.status::text INTO payment_status
    FROM erp.ap_payments p
   WHERE p.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.payment_id ELSE NEW.payment_id END;

  IF payment_status IS NOT NULL AND payment_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'erp: the lines of a submitted or posted payment cannot be changed';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER "ap_payment_lines_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "erp"."ap_payment_lines"
  FOR EACH ROW
  EXECUTE FUNCTION "erp"."ap_payment_lines_guard"();

-- ---------------------------------------------------------------------------
-- 3. Settlement: posting a payment applies each line to its bill, and voiding a
--    posted payment takes it back — under row locks taken in bill order, so two
--    payments posting against one bill queue rather than overpay it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "erp"."ap_payments_apply"()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
DECLARE
  direction integer;
  line record;
  bill record;
  new_paid bigint;
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NULL;
  END IF;

  direction := CASE
    WHEN NEW.status = 'POSTED' THEN 1
    WHEN OLD.status = 'POSTED' AND NEW.status = 'CANCELLED' THEN -1
    ELSE 0
  END;
  IF direction = 0 THEN
    RETURN NULL;
  END IF;

  FOR line IN
    SELECT l.bill_id, l.amount_minor
      FROM erp.ap_payment_lines l
     WHERE l.payment_id = NEW.id
     ORDER BY l.bill_id
  LOOP
    SELECT b.status::text AS status, b.vendor_id, b.payable_account_id, b.currency,
           b.total_minor, b.paid_minor
      INTO bill
      FROM erp.ap_bills b WHERE b.id = line.bill_id
      FOR UPDATE;

    IF bill.status IS NULL OR bill.status NOT IN ('POSTED', 'PARTIALLY_PAID', 'PAID') THEN
      RAISE EXCEPTION 'erp: a payment can only settle posted bills';
    END IF;
    IF bill.vendor_id <> NEW.vendor_id THEN
      RAISE EXCEPTION 'erp: a payment can only settle bills of its vendor';
    END IF;
    IF bill.payable_account_id <> NEW.payable_account_id OR bill.currency <> NEW.currency THEN
      RAISE EXCEPTION 'erp: the payment and the bill use different payable accounts or currencies';
    END IF;

    new_paid := bill.paid_minor + direction * line.amount_minor;
    IF new_paid > bill.total_minor THEN
      RAISE EXCEPTION 'erp: the payment is more than the outstanding amount of the bill';
    END IF;

    UPDATE erp.ap_bills
       SET paid_minor = new_paid,
           outstanding_minor = total_minor - new_paid,
           status = (CASE
             WHEN new_paid = 0 THEN 'POSTED'
             WHEN new_paid >= total_minor THEN 'PAID'
             ELSE 'PARTIALLY_PAID'
           END)::"erp"."ErpApBillStatus",
           updated_at = now()
     WHERE id = line.bill_id;
  END LOOP;

  RETURN NULL;
END;
$$;

CREATE TRIGGER "ap_payments_apply"
  AFTER UPDATE ON "erp"."ap_payments"
  FOR EACH ROW
  EXECUTE FUNCTION "erp"."ap_payments_apply"();

-- ---------------------------------------------------------------------------
-- 4. At COMMIT: a bill's totals equal its lines and its paid amount equals its
--    posted payments; a payment's totals equal its lines, each line's withholding
--    base is the VAT-exclusive share of what it settles, and its bills belong to its
--    vendor; a bill or payment in the ledger matches its journal entry.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "erp"."ap_check_bill"(p_bill_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
DECLARE
  bill record;
  sums record;
  settled bigint;
  journal record;
  reversal record;
BEGIN
  SELECT b.id, b.status::text AS status, b.subtotal_minor, b.discount_minor, b.tax_minor,
         b.total_minor, b.paid_minor, b.bill_date, b.journal_entry_id, b.void_journal_entry_id
    INTO bill
    FROM erp.ap_bills b WHERE b.id = p_bill_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT count(*) AS line_count, coalesce(sum(l.gross_minor), 0) AS gross,
         coalesce(sum(l.discount_minor), 0) AS discount, coalesce(sum(l.tax_minor), 0) AS tax,
         coalesce(sum(l.total_minor), 0) AS total
    INTO sums
    FROM erp.ap_bill_lines l WHERE l.bill_id = p_bill_id;

  IF bill.subtotal_minor <> sums.gross OR bill.discount_minor <> sums.discount
     OR bill.tax_minor <> sums.tax OR bill.total_minor <> sums.total THEN
    RAISE EXCEPTION 'erp: the bill totals do not match its lines';
  END IF;

  SELECT coalesce(sum(l.amount_minor), 0) INTO settled
    FROM erp.ap_payment_lines l
    JOIN erp.ap_payments p ON p.id = l.payment_id
   WHERE l.bill_id = p_bill_id AND p.status = 'POSTED';
  IF bill.paid_minor <> settled THEN
    RAISE EXCEPTION 'erp: the amount paid on the bill does not match its posted payments';
  END IF;

  IF bill.status IN ('PENDING_APPROVAL', 'APPROVED', 'POSTED', 'PARTIALLY_PAID', 'PAID')
     AND (sums.line_count = 0 OR bill.total_minor <= 0) THEN
    RAISE EXCEPTION 'erp: a submitted bill needs at least one line and a total above zero';
  END IF;

  IF bill.journal_entry_id IS NOT NULL THEN
    SELECT e.status::text AS status, e.source_module, e.source_type, e.source_id,
           e.total_minor, e.entry_date
      INTO journal
      FROM erp.journal_entries e WHERE e.id = bill.journal_entry_id;
    IF journal.source_module IS DISTINCT FROM 'erp'
       OR journal.source_type IS DISTINCT FROM 'ap_bill'
       OR journal.source_id IS DISTINCT FROM bill.id::text THEN
      RAISE EXCEPTION 'erp: the bill journal entry belongs to another document';
    END IF;
    IF journal.total_minor <> bill.total_minor OR journal.entry_date <> bill.bill_date THEN
      RAISE EXCEPTION 'erp: the bill journal entry does not match the bill';
    END IF;
    IF bill.status IN ('POSTED', 'PARTIALLY_PAID', 'PAID') AND journal.status <> 'POSTED' THEN
      RAISE EXCEPTION 'erp: a posted bill needs its posted journal entry';
    END IF;
    IF bill.status = 'CANCELLED' THEN
      SELECT v.status::text AS status, v.reverses_entry_id INTO reversal
        FROM erp.journal_entries v WHERE v.id = bill.void_journal_entry_id;
      IF journal.status <> 'REVERSED' OR reversal.status IS DISTINCT FROM 'POSTED'
         OR reversal.reverses_entry_id IS DISTINCT FROM bill.journal_entry_id THEN
        RAISE EXCEPTION 'erp: a voided bill needs its journal entry reversed by its void entry';
      END IF;
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "erp"."ap_bills_check"()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
  PERFORM erp.ap_check_bill(NEW.id);
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "ap_bills_check"
  AFTER INSERT OR UPDATE ON "erp"."ap_bills"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION "erp"."ap_bills_check"();

CREATE OR REPLACE FUNCTION "erp"."ap_bill_lines_check"()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
  PERFORM erp.ap_check_bill(CASE WHEN TG_OP = 'DELETE' THEN OLD.bill_id ELSE NEW.bill_id END);
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "ap_bill_lines_check"
  AFTER INSERT OR UPDATE OR DELETE ON "erp"."ap_bill_lines"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION "erp"."ap_bill_lines_check"();

CREATE OR REPLACE FUNCTION "erp"."ap_check_payment"(p_payment_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
DECLARE
  payment record;
  sums record;
  mismatch record;
  journal record;
  reversal record;
BEGIN
  SELECT p.id, p.status::text AS status, p.vendor_id, p.amount_minor, p.withheld_minor,
         p.cash_minor, p.payment_date, p.journal_entry_id, p.void_journal_entry_id
    INTO payment
    FROM erp.ap_payments p WHERE p.id = p_payment_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT count(*) AS line_count, coalesce(sum(l.amount_minor), 0) AS amount,
         coalesce(sum(l.withheld_minor), 0) AS withheld, coalesce(sum(l.cash_minor), 0) AS cash
    INTO sums
    FROM erp.ap_payment_lines l WHERE l.payment_id = p_payment_id;
  IF payment.amount_minor <> sums.amount OR payment.withheld_minor <> sums.withheld
     OR payment.cash_minor <> sums.cash THEN
    RAISE EXCEPTION 'erp: the payment totals do not match its lines';
  END IF;

  IF payment.status IN ('PENDING_APPROVAL', 'APPROVED', 'POSTED')
     AND (sums.line_count = 0 OR payment.amount_minor <= 0) THEN
    RAISE EXCEPTION 'erp: a submitted payment needs at least one bill and an amount above zero';
  END IF;

  -- Each line settles a bill of the payment's vendor, and tax is withheld on the part
  -- of the amount that excludes VAT: amount × (bill net ÷ bill total).
  SELECT l.line_no, b.vendor_id,
         CASE
           WHEN l.withholding_basis_points IS NULL THEN 0
           WHEN b.total_minor = 0 THEN 0
           ELSE round(l.amount_minor::numeric * (b.subtotal_minor - b.discount_minor) / b.total_minor)
         END AS expected_base,
         l.withholding_base_minor
    INTO mismatch
    FROM erp.ap_payment_lines l
    JOIN erp.ap_bills b ON b.id = l.bill_id
   WHERE l.payment_id = p_payment_id
     AND (b.vendor_id <> payment.vendor_id
       OR l.withholding_base_minor <> CASE
            WHEN l.withholding_basis_points IS NULL THEN 0
            WHEN b.total_minor = 0 THEN 0
            ELSE round(l.amount_minor::numeric * (b.subtotal_minor - b.discount_minor) / b.total_minor)
          END)
   LIMIT 1;
  IF FOUND THEN
    IF mismatch.vendor_id <> payment.vendor_id THEN
      RAISE EXCEPTION 'erp: a payment can only settle bills of its vendor';
    END IF;
    RAISE EXCEPTION 'erp: the withholding base of a payment line is not the VAT-exclusive part of its amount';
  END IF;

  IF payment.journal_entry_id IS NOT NULL THEN
    SELECT e.status::text AS status, e.source_module, e.source_type, e.source_id,
           e.total_minor, e.entry_date
      INTO journal
      FROM erp.journal_entries e WHERE e.id = payment.journal_entry_id;
    IF journal.source_module IS DISTINCT FROM 'erp'
       OR journal.source_type IS DISTINCT FROM 'ap_payment'
       OR journal.source_id IS DISTINCT FROM payment.id::text THEN
      RAISE EXCEPTION 'erp: the payment journal entry belongs to another document';
    END IF;
    IF journal.total_minor <> payment.amount_minor OR journal.entry_date <> payment.payment_date THEN
      RAISE EXCEPTION 'erp: the payment journal entry does not match the payment';
    END IF;
    IF payment.status = 'POSTED' AND journal.status <> 'POSTED' THEN
      RAISE EXCEPTION 'erp: a posted payment needs its posted journal entry';
    END IF;
    IF payment.status = 'CANCELLED' THEN
      SELECT v.status::text AS status, v.reverses_entry_id INTO reversal
        FROM erp.journal_entries v WHERE v.id = payment.void_journal_entry_id;
      IF journal.status <> 'REVERSED' OR reversal.status IS DISTINCT FROM 'POSTED'
         OR reversal.reverses_entry_id IS DISTINCT FROM payment.journal_entry_id THEN
        RAISE EXCEPTION 'erp: a voided payment needs its journal entry reversed by its void entry';
      END IF;
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "erp"."ap_payments_check"()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
  PERFORM erp.ap_check_payment(NEW.id);
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "ap_payments_check"
  AFTER INSERT OR UPDATE ON "erp"."ap_payments"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION "erp"."ap_payments_check"();

CREATE OR REPLACE FUNCTION "erp"."ap_payment_lines_check"()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
  PERFORM erp.ap_check_payment(CASE WHEN TG_OP = 'DELETE' THEN OLD.payment_id ELSE NEW.payment_id END);
  -- A line's bill is reconciled too: its paid amount counts posted payments' lines.
  PERFORM erp.ap_check_bill(CASE WHEN TG_OP = 'DELETE' THEN OLD.bill_id ELSE NEW.bill_id END);
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "ap_payment_lines_check"
  AFTER INSERT OR UPDATE OR DELETE ON "erp"."ap_payment_lines"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION "erp"."ap_payment_lines_check"();

-- A journal entry raised by a bill or payment is reversed only by voiding that
-- document. Replaces the version that knew receivables only (ADR-029).
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
  IF NEW.status::text = 'REVERSED' AND NEW.source_type = 'ar_credit_note' AND NOT EXISTS (
    SELECT 1 FROM erp.ar_credit_notes c WHERE c.journal_entry_id = NEW.id AND c.status = 'CANCELLED'
  ) THEN
    RAISE EXCEPTION 'erp: the journal entry of a credit note is reversed only by voiding the credit note';
  END IF;
  IF NEW.status::text = 'REVERSED' AND NEW.source_type = 'ap_bill' AND NOT EXISTS (
    SELECT 1 FROM erp.ap_bills b WHERE b.journal_entry_id = NEW.id AND b.status = 'CANCELLED'
  ) THEN
    RAISE EXCEPTION 'erp: the journal entry of a bill is reversed only by voiding the bill';
  END IF;
  IF NEW.status::text = 'REVERSED' AND NEW.source_type = 'ap_payment' AND NOT EXISTS (
    SELECT 1 FROM erp.ap_payments p WHERE p.journal_entry_id = NEW.id AND p.status = 'CANCELLED'
  ) THEN
    RAISE EXCEPTION 'erp: the journal entry of a payment is reversed only by voiding the payment';
  END IF;
  RETURN NULL;
END;
$$;

-- Bills and payments are numbered from their own series.
ALTER TABLE "erp"."number_series"
  DROP CONSTRAINT "number_series_document_type",
  ADD CONSTRAINT "number_series_document_type"
    CHECK ("document_type" IN ('AR_INVOICE', 'AR_CREDIT_NOTE', 'AR_RECEIPT', 'AP_BILL', 'AP_PAYMENT'));

REVOKE ALL ON FUNCTION "erp"."ap_bills_guard"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "erp"."ap_bill_lines_guard"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "erp"."ap_payments_guard"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "erp"."ap_payment_lines_guard"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "erp"."ap_payments_apply"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "erp"."ap_check_bill"(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION "erp"."ap_bills_check"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "erp"."ap_bill_lines_check"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "erp"."ap_check_payment"(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION "erp"."ap_payments_check"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "erp"."ap_payment_lines_check"() FROM PUBLIC;
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
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA erp FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA erp FROM %I', api_role);
    END IF;
  END LOOP;
END $$;
