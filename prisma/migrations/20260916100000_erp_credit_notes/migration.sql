
-- CreateEnum
CREATE TYPE "erp"."ErpArCreditNoteStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "erp"."ar_invoices" ADD COLUMN     "credited_minor" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "erp"."ar_credit_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "credit_note_number" TEXT,
    "invoice_id" UUID NOT NULL,
    "crm_account_id" UUID NOT NULL,
    "credit_note_date" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EGP',
    "status" "erp"."ErpArCreditNoteStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal_minor" BIGINT NOT NULL DEFAULT 0,
    "discount_minor" BIGINT NOT NULL DEFAULT 0,
    "tax_minor" BIGINT NOT NULL DEFAULT 0,
    "total_minor" BIGINT NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
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

    CONSTRAINT "ar_credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp"."ar_credit_note_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "credit_note_id" UUID NOT NULL,
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

    CONSTRAINT "ar_credit_note_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ar_credit_notes_credit_note_number_key" ON "erp"."ar_credit_notes"("credit_note_number");

-- CreateIndex
CREATE UNIQUE INDEX "ar_credit_notes_journal_entry_id_key" ON "erp"."ar_credit_notes"("journal_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "ar_credit_notes_void_journal_entry_id_key" ON "erp"."ar_credit_notes"("void_journal_entry_id");

-- CreateIndex
CREATE INDEX "ar_credit_notes_invoice_id_idx" ON "erp"."ar_credit_notes"("invoice_id");

-- CreateIndex
CREATE INDEX "ar_credit_notes_crm_account_id_status_idx" ON "erp"."ar_credit_notes"("crm_account_id", "status");

-- CreateIndex
CREATE INDEX "ar_credit_notes_status_credit_note_date_idx" ON "erp"."ar_credit_notes"("status", "credit_note_date" DESC);

-- CreateIndex
CREATE INDEX "ar_credit_notes_credit_note_date_idx" ON "erp"."ar_credit_notes"("credit_note_date" DESC);

-- CreateIndex
CREATE INDEX "ar_credit_notes_fiscal_period_id_idx" ON "erp"."ar_credit_notes"("fiscal_period_id");

-- CreateIndex
CREATE INDEX "ar_credit_notes_created_by_idx" ON "erp"."ar_credit_notes"("created_by");

-- CreateIndex
CREATE INDEX "ar_credit_note_lines_revenue_account_id_idx" ON "erp"."ar_credit_note_lines"("revenue_account_id");

-- CreateIndex
CREATE INDEX "ar_credit_note_lines_tax_rate_id_idx" ON "erp"."ar_credit_note_lines"("tax_rate_id");

-- CreateIndex
CREATE INDEX "ar_credit_note_lines_cost_centre_id_idx" ON "erp"."ar_credit_note_lines"("cost_centre_id");

-- CreateIndex
CREATE UNIQUE INDEX "ar_credit_note_lines_credit_note_id_line_no_key" ON "erp"."ar_credit_note_lines"("credit_note_id", "line_no");

-- AddForeignKey
ALTER TABLE "erp"."ar_credit_notes" ADD CONSTRAINT "ar_credit_notes_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "erp"."ar_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ar_credit_notes" ADD CONSTRAINT "ar_credit_notes_receivable_account_id_fkey" FOREIGN KEY ("receivable_account_id") REFERENCES "erp"."accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ar_credit_notes" ADD CONSTRAINT "ar_credit_notes_fiscal_period_id_fkey" FOREIGN KEY ("fiscal_period_id") REFERENCES "erp"."fiscal_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ar_credit_notes" ADD CONSTRAINT "ar_credit_notes_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "erp"."journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ar_credit_notes" ADD CONSTRAINT "ar_credit_notes_void_journal_entry_id_fkey" FOREIGN KEY ("void_journal_entry_id") REFERENCES "erp"."journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ar_credit_notes" ADD CONSTRAINT "ar_credit_notes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ar_credit_notes" ADD CONSTRAINT "ar_credit_notes_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ar_credit_notes" ADD CONSTRAINT "ar_credit_notes_posted_by_fkey" FOREIGN KEY ("posted_by") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ar_credit_note_lines" ADD CONSTRAINT "ar_credit_note_lines_credit_note_id_fkey" FOREIGN KEY ("credit_note_id") REFERENCES "erp"."ar_credit_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ar_credit_note_lines" ADD CONSTRAINT "ar_credit_note_lines_tax_rate_id_fkey" FOREIGN KEY ("tax_rate_id") REFERENCES "erp"."tax_rates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ar_credit_note_lines" ADD CONSTRAINT "ar_credit_note_lines_revenue_account_id_fkey" FOREIGN KEY ("revenue_account_id") REFERENCES "erp"."accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp"."ar_credit_note_lines" ADD CONSTRAINT "ar_credit_note_lines_cost_centre_id_fkey" FOREIGN KEY ("cost_centre_id") REFERENCES "erp"."cost_centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- Credit note invariants (ADR-029). A credit note corrects ONE posted invoice and
-- can never exceed what that invoice still owes. Everything below holds for every
-- writer, including the owner connection the application uses.
-- ===========================================================================

ALTER TABLE "erp"."ar_credit_notes"
  ADD CONSTRAINT "ar_credit_notes_currency" CHECK ("currency" = 'EGP'),
  ADD CONSTRAINT "ar_credit_notes_amounts_non_negative" CHECK (
    "subtotal_minor" >= 0 AND "discount_minor" >= 0 AND "tax_minor" >= 0 AND "total_minor" >= 0
  ),
  ADD CONSTRAINT "ar_credit_notes_total_adds_up"
    CHECK ("total_minor" = "subtotal_minor" - "discount_minor" + "tax_minor"),
  ADD CONSTRAINT "ar_credit_notes_reason_not_blank" CHECK (btrim("reason") <> ''),
  ADD CONSTRAINT "ar_credit_notes_lifecycle" CHECK (
    ("status" = 'DRAFT'
      AND "credit_note_number" IS NULL AND "journal_entry_id" IS NULL AND "fiscal_period_id" IS NULL
      AND "posted_at" IS NULL AND "approved_at" IS NULL AND "submitted_at" IS NULL
      AND "cancelled_at" IS NULL AND "void_journal_entry_id" IS NULL)
    OR ("status" = 'PENDING_APPROVAL'
      AND "submitted_at" IS NOT NULL AND "submitted_by" IS NOT NULL AND "approved_at" IS NULL
      AND "credit_note_number" IS NULL AND "journal_entry_id" IS NULL AND "cancelled_at" IS NULL)
    OR ("status" = 'APPROVED'
      AND "submitted_at" IS NOT NULL AND "approved_at" IS NOT NULL
      AND ("approved_by" IS NOT NULL OR "approval_skipped")
      AND "credit_note_number" IS NULL AND "journal_entry_id" IS NULL AND "cancelled_at" IS NULL)
    OR ("status" = 'POSTED'
      AND "approved_at" IS NOT NULL AND "credit_note_number" IS NOT NULL
      AND "journal_entry_id" IS NOT NULL AND "fiscal_period_id" IS NOT NULL
      AND "posted_at" IS NOT NULL AND "posted_by" IS NOT NULL
      AND "cancelled_at" IS NULL AND "void_journal_entry_id" IS NULL)
    OR ("status" = 'CANCELLED'
      AND "cancelled_at" IS NOT NULL AND "cancelled_by" IS NOT NULL AND "cancel_reason" IS NOT NULL
      AND (("journal_entry_id" IS NULL AND "void_journal_entry_id" IS NULL
            AND "credit_note_number" IS NULL)
        OR ("journal_entry_id" IS NOT NULL AND "void_journal_entry_id" IS NOT NULL
          AND "credit_note_number" IS NOT NULL)))
  );

-- Every stored line figure re-derives from quantity, price, discount and rate, exactly
-- as the invoice lines do.
ALTER TABLE "erp"."ar_credit_note_lines"
  ADD CONSTRAINT "ar_credit_note_lines_line_no_positive" CHECK ("line_no" >= 1),
  ADD CONSTRAINT "ar_credit_note_lines_description_not_blank" CHECK (btrim("description") <> ''),
  ADD CONSTRAINT "ar_credit_note_lines_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "ar_credit_note_lines_price_non_negative" CHECK ("unit_price_minor" >= 0),
  ADD CONSTRAINT "ar_credit_note_lines_gross"
    CHECK ("gross_minor" = round("quantity" * "unit_price_minor")),
  ADD CONSTRAINT "ar_credit_note_lines_discount_range"
    CHECK ("discount_minor" >= 0 AND "discount_minor" <= "gross_minor"),
  ADD CONSTRAINT "ar_credit_note_lines_net" CHECK ("net_minor" = "gross_minor" - "discount_minor"),
  ADD CONSTRAINT "ar_credit_note_lines_tax_rate_pair"
    CHECK (("tax_rate_id" IS NULL) = ("tax_rate_basis_points" IS NULL)),
  ADD CONSTRAINT "ar_credit_note_lines_tax_rate_range"
    CHECK ("tax_rate_basis_points" IS NULL OR "tax_rate_basis_points" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "ar_credit_note_lines_tax" CHECK (
    "tax_minor" = CASE
      WHEN "tax_rate_basis_points" IS NULL THEN 0
      ELSE round("net_minor"::numeric * "tax_rate_basis_points" / 10000)
    END
  ),
  ADD CONSTRAINT "ar_credit_note_lines_total" CHECK ("total_minor" = "net_minor" + "tax_minor");

-- An invoice's outstanding amount now allows for credit notes as well as payments.
ALTER TABLE "erp"."ar_invoices"
  DROP CONSTRAINT "ar_invoices_outstanding",
  ADD CONSTRAINT "ar_invoices_credited_range" CHECK (
    "credited_minor" >= 0 AND "paid_minor" + "credited_minor" <= "total_minor"
  ),
  ADD CONSTRAINT "ar_invoices_outstanding" CHECK (
    "outstanding_minor" = CASE
      WHEN "status" IN ('POSTED', 'PARTIALLY_PAID', 'PAID')
        THEN "total_minor" - "paid_minor" - "credited_minor"
      ELSE 0
    END
  );

-- The invoice guard, now letting the credited amount move with a credit note and
-- refusing to void an invoice that has been credited.
CREATE OR REPLACE FUNCTION "erp"."ar_invoices_guard"()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
DECLARE
  payment_columns constant text[] :=
    ARRAY['status', 'paid_minor', 'credited_minor', 'outstanding_minor', 'updated_at',
          'updated_by'];
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
      IF OLD.paid_minor <> 0 OR OLD.credited_minor <> 0
         OR (to_jsonb(NEW) - void_columns) IS DISTINCT FROM (to_jsonb(OLD) - void_columns) THEN
        RAISE EXCEPTION 'erp: only an unpaid, uncredited posted invoice can be voided';
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

-- Allocation now leaves room for credit notes: paid plus credited never exceeds the total.
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
         i.total_minor, i.paid_minor, i.credited_minor
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
  IF invoice.paid_minor + delta > invoice.total_minor - invoice.credited_minor THEN
    RAISE EXCEPTION 'erp: the allocation is more than the outstanding amount of the invoice';
  END IF;

  UPDATE erp.ar_receipts
     SET allocated_minor = allocated_minor + delta, updated_at = now()
   WHERE id = target_receipt;
  UPDATE erp.ar_invoices
     SET paid_minor = paid_minor + delta,
         outstanding_minor = total_minor - (paid_minor + delta) - credited_minor,
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

-- Posting or voiding a credit note is what moves the invoice's credited amount.
CREATE OR REPLACE FUNCTION "erp"."ar_credit_notes_apply"()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
DECLARE
  invoice record;
  delta bigint;
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NULL;
  END IF;

  delta := CASE
    WHEN NEW.status = 'POSTED' THEN NEW.total_minor
    WHEN OLD.status = 'POSTED' AND NEW.status = 'CANCELLED' THEN -OLD.total_minor
    ELSE 0
  END;
  IF delta = 0 THEN
    RETURN NULL;
  END IF;

  SELECT i.status::text AS status, i.total_minor, i.paid_minor, i.credited_minor,
         i.crm_account_id, i.receivable_account_id, i.currency
    INTO invoice
    FROM erp.ar_invoices i WHERE i.id = NEW.invoice_id
    FOR UPDATE;
  IF invoice.status IS NULL OR invoice.status NOT IN ('POSTED', 'PARTIALLY_PAID', 'PAID') THEN
    RAISE EXCEPTION 'erp: only a posted invoice can be credited';
  END IF;
  IF invoice.crm_account_id <> NEW.crm_account_id THEN
    RAISE EXCEPTION 'erp: a credit note belongs to the customer of its invoice';
  END IF;
  IF invoice.receivable_account_id <> NEW.receivable_account_id
     OR invoice.currency <> NEW.currency THEN
    RAISE EXCEPTION 'erp: a credit note uses the receivable account and currency of its invoice';
  END IF;
  IF invoice.paid_minor + invoice.credited_minor + delta > invoice.total_minor THEN
    RAISE EXCEPTION 'erp: the credit note is more than the outstanding amount of the invoice';
  END IF;

  UPDATE erp.ar_invoices
     SET credited_minor = credited_minor + delta,
         outstanding_minor = total_minor - paid_minor - (credited_minor + delta),
         updated_at = now()
   WHERE id = NEW.invoice_id;

  RETURN NULL;
END;
$$;

CREATE TRIGGER "ar_credit_notes_apply"
  AFTER UPDATE ON "erp"."ar_credit_notes"
  FOR EACH ROW
  EXECUTE FUNCTION "erp"."ar_credit_notes_apply"();

-- The credit note lifecycle: created as a draft, posted once approved, then frozen
-- except for being voided.
CREATE OR REPLACE FUNCTION "erp"."ar_credit_notes_guard"()
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
      RAISE EXCEPTION 'erp: a credit note is created as a draft';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'erp: only a draft credit note can be deleted; cancel it instead';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'erp: a cancelled credit note cannot be changed';
  END IF;
  IF NEW.invoice_id <> OLD.invoice_id THEN
    RAISE EXCEPTION 'erp: a credit note stays with the invoice it was raised against';
  END IF;

  IF OLD.status = 'POSTED' THEN
    IF NEW.status = 'CANCELLED' THEN
      IF (to_jsonb(NEW) - void_columns) IS DISTINCT FROM (to_jsonb(OLD) - void_columns) THEN
        RAISE EXCEPTION 'erp: a posted credit note is corrected only by voiding it';
      END IF;
    ELSE
      RAISE EXCEPTION 'erp: a posted credit note cannot be changed; void it instead';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'POSTED' AND OLD.status <> 'APPROVED' THEN
    RAISE EXCEPTION 'erp: only an approved credit note can be posted';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ar_credit_notes_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "erp"."ar_credit_notes"
  FOR EACH ROW
  EXECUTE FUNCTION "erp"."ar_credit_notes_guard"();

CREATE OR REPLACE FUNCTION "erp"."ar_credit_note_lines_guard"()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
DECLARE
  credit_note_status text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.credit_note_id <> OLD.credit_note_id THEN
    RAISE EXCEPTION 'erp: a credit note line cannot move to another credit note';
  END IF;

  SELECT c.status::text INTO credit_note_status
    FROM erp.ar_credit_notes c
   WHERE c.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.credit_note_id ELSE NEW.credit_note_id END;

  -- No credit note row means a draft is being deleted and its lines cascade with it.
  IF credit_note_status IS NOT NULL AND credit_note_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'erp: the lines of a submitted or posted credit note cannot be changed';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER "ar_credit_note_lines_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "erp"."ar_credit_note_lines"
  FOR EACH ROW
  EXECUTE FUNCTION "erp"."ar_credit_note_lines_guard"();

-- Checked at COMMIT, once the credit note and all of its lines are in place.
CREATE OR REPLACE FUNCTION "erp"."ar_check_credit_note"(p_credit_note_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
DECLARE
  note record;
  sums record;
  journal record;
  reversal record;
BEGIN
  SELECT c.id, c.status::text AS status, c.subtotal_minor, c.discount_minor, c.tax_minor,
         c.total_minor, c.credit_note_date, c.journal_entry_id, c.void_journal_entry_id
    INTO note
    FROM erp.ar_credit_notes c WHERE c.id = p_credit_note_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT count(*) AS line_count, coalesce(sum(l.gross_minor), 0) AS gross,
         coalesce(sum(l.discount_minor), 0) AS discount, coalesce(sum(l.tax_minor), 0) AS tax,
         coalesce(sum(l.total_minor), 0) AS total
    INTO sums
    FROM erp.ar_credit_note_lines l WHERE l.credit_note_id = p_credit_note_id;

  IF note.subtotal_minor <> sums.gross OR note.discount_minor <> sums.discount
     OR note.tax_minor <> sums.tax OR note.total_minor <> sums.total THEN
    RAISE EXCEPTION 'erp: the credit note totals do not match its lines';
  END IF;

  IF note.status IN ('PENDING_APPROVAL', 'APPROVED', 'POSTED')
     AND (sums.line_count = 0 OR note.total_minor <= 0) THEN
    RAISE EXCEPTION 'erp: a submitted credit note needs at least one line and a total above zero';
  END IF;

  IF note.journal_entry_id IS NOT NULL THEN
    SELECT e.status::text AS status, e.source_module, e.source_type, e.source_id,
           e.total_minor, e.entry_date
      INTO journal
      FROM erp.journal_entries e WHERE e.id = note.journal_entry_id;
    IF journal.source_module IS DISTINCT FROM 'erp'
       OR journal.source_type IS DISTINCT FROM 'ar_credit_note'
       OR journal.source_id IS DISTINCT FROM note.id::text THEN
      RAISE EXCEPTION 'erp: the credit note journal entry belongs to another document';
    END IF;
    IF journal.total_minor <> note.total_minor OR journal.entry_date <> note.credit_note_date THEN
      RAISE EXCEPTION 'erp: the credit note journal entry does not match the credit note';
    END IF;
    IF note.status = 'POSTED' AND journal.status <> 'POSTED' THEN
      RAISE EXCEPTION 'erp: a posted credit note needs its posted journal entry';
    END IF;
    IF note.status = 'CANCELLED' THEN
      SELECT v.status::text AS status, v.reverses_entry_id INTO reversal
        FROM erp.journal_entries v WHERE v.id = note.void_journal_entry_id;
      IF journal.status <> 'REVERSED' OR reversal.status IS DISTINCT FROM 'POSTED'
         OR reversal.reverses_entry_id IS DISTINCT FROM note.journal_entry_id THEN
        RAISE EXCEPTION 'erp: a voided credit note needs its journal entry reversed by its void entry';
      END IF;
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "erp"."ar_credit_notes_check"()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
  PERFORM erp.ar_check_credit_note(NEW.id);
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "ar_credit_notes_check"
  AFTER INSERT OR UPDATE ON "erp"."ar_credit_notes"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION "erp"."ar_credit_notes_check"();

CREATE OR REPLACE FUNCTION "erp"."ar_credit_note_lines_check"()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
  PERFORM erp.ar_check_credit_note(
    CASE WHEN TG_OP = 'DELETE' THEN OLD.credit_note_id ELSE NEW.credit_note_id END
  );
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "ar_credit_note_lines_check"
  AFTER INSERT OR UPDATE OR DELETE ON "erp"."ar_credit_note_lines"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION "erp"."ar_credit_note_lines_check"();

-- The invoice check now also reconciles the credited amount with its credit notes.
CREATE OR REPLACE FUNCTION "erp"."ar_check_invoice"(p_invoice_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
DECLARE
  invoice record;
  sums record;
  allocated bigint;
  credited bigint;
  journal record;
  reversal record;
BEGIN
  SELECT i.id, i.status::text AS status, i.subtotal_minor, i.discount_minor, i.tax_minor,
         i.total_minor, i.paid_minor, i.credited_minor, i.invoice_date, i.journal_entry_id,
         i.void_journal_entry_id
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

  SELECT coalesce(sum(c.total_minor), 0) INTO credited
    FROM erp.ar_credit_notes c
   WHERE c.invoice_id = p_invoice_id AND c.status = 'POSTED';
  IF invoice.credited_minor <> credited THEN
    RAISE EXCEPTION 'erp: the amount credited on the invoice does not match its credit notes';
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

-- A credit note's journal entry is reversed only by voiding the credit note.
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
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION "erp"."ar_credit_notes_guard"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "erp"."ar_credit_note_lines_guard"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "erp"."ar_credit_notes_apply"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "erp"."ar_check_credit_note"(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION "erp"."ar_credit_notes_check"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "erp"."ar_credit_note_lines_check"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "erp"."ar_invoices_guard"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "erp"."ar_receipt_allocations_apply"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "erp"."ar_check_invoice"(uuid) FROM PUBLIC;
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
