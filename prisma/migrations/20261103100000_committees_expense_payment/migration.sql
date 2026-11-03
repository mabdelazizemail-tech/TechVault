-- Mission expenses marked as paid (ADR-040): once an approved claim has been paid, a
-- Committees administrator records the payment date, an optional reference, and who
-- recorded it and when.

-- AlterTable
ALTER TABLE "committees"."mission_expenses" ADD COLUMN     "paid_at" TIMESTAMPTZ(6),
ADD COLUMN     "paid_by" UUID,
ADD COLUMN     "paid_on" DATE,
ADD COLUMN     "payment_reference" TEXT;

-- AddForeignKey
ALTER TABLE "committees"."mission_expenses" ADD CONSTRAINT "mission_expenses_paid_by_fkey" FOREIGN KEY ("paid_by") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- What must hold for every writer.
-- ---------------------------------------------------------------------------
ALTER TABLE "committees"."mission_expenses"
  -- A payment is recorded whole: when it was paid, when that was recorded, by whom.
  ADD CONSTRAINT "mission_expenses_paid_recorded"
    CHECK (num_nulls("paid_on", "paid_at", "paid_by") IN (0, 3)),
  -- Only an approved claim is paid.
  ADD CONSTRAINT "mission_expenses_paid_when_approved"
    CHECK ("paid_on" IS NULL OR "status" = 'APPROVED'),
  ADD CONSTRAINT "mission_expenses_paid_on_range"
    CHECK ("paid_on" IS NULL OR "paid_on" BETWEEN DATE '2000-01-01' AND DATE '2100-12-31'),
  ADD CONSTRAINT "mission_expenses_payment_reference"
    CHECK ("payment_reference" IS NULL
           OR ("paid_on" IS NOT NULL AND length(btrim("payment_reference")) BETWEEN 1 AND 200));

-- Replaces the guard of 20261015100000. Unchanged: a claim's own fields never
-- change, a claim is reviewed once, its USD rate is fixed once, deleting it changes
-- nothing else, a deleted claim never changes again, and no row is removed. New: a
-- payment is recorded only on a claim already approved, and a recorded payment is
-- cleared (marked unpaid, which the service audits with a reason) before another is
-- recorded — never overwritten in place.
CREATE OR REPLACE FUNCTION "committees"."mission_expenses_guard"()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
DECLARE
  payment_changed boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'committees: mission expenses are never deleted from the table; an administrator marks one deleted';
  END IF;
  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'committees: a deleted mission expense cannot change';
  END IF;
  IF (NEW.mission_id, NEW.submitted_by, NEW.category, NEW.description, NEW.expense_date,
      NEW.amount_minor, NEW.currency, NEW.receipt_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.mission_id, OLD.submitted_by, OLD.category, OLD.description, OLD.expense_date,
      OLD.amount_minor, OLD.currency, OLD.receipt_id, OLD.created_at) THEN
    RAISE EXCEPTION 'committees: a submitted mission expense cannot be edited';
  END IF;
  IF OLD.usd_rate IS NOT NULL
     AND (NEW.usd_rate, NEW.usd_rate_at, NEW.usd_rate_source, NEW.usd_converted_at)
         IS DISTINCT FROM
         (OLD.usd_rate, OLD.usd_rate_at, OLD.usd_rate_source, OLD.usd_converted_at) THEN
    RAISE EXCEPTION 'committees: the USD conversion of a mission expense is fixed once set';
  END IF;

  payment_changed := (NEW.paid_on, NEW.paid_at, NEW.paid_by, NEW.payment_reference)
                     IS DISTINCT FROM
                     (OLD.paid_on, OLD.paid_at, OLD.paid_by, OLD.payment_reference);

  IF NEW.deleted_at IS NOT NULL THEN
    IF (NEW.status, NEW.reviewed_by, NEW.reviewed_at, NEW.review_note)
       IS DISTINCT FROM
       (OLD.status, OLD.reviewed_by, OLD.reviewed_at, OLD.review_note) THEN
      RAISE EXCEPTION 'committees: deleting a mission expense cannot also review it';
    END IF;
    IF payment_changed THEN
      RAISE EXCEPTION 'committees: deleting a mission expense cannot also change its payment';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'SUBMITTED'
     AND (NEW.status, NEW.reviewed_by, NEW.reviewed_at, NEW.review_note)
         IS DISTINCT FROM
         (OLD.status, OLD.reviewed_by, OLD.reviewed_at, OLD.review_note) THEN
    RAISE EXCEPTION 'committees: a reviewed mission expense cannot change';
  END IF;
  IF payment_changed THEN
    IF OLD.status <> 'APPROVED' THEN
      RAISE EXCEPTION 'committees: a mission expense is paid only once it is approved';
    END IF;
    IF OLD.paid_on IS NOT NULL AND NEW.paid_on IS NOT NULL THEN
      RAISE EXCEPTION 'committees: a recorded payment is cleared before another is recorded';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION "committees"."mission_expenses_guard"() FROM PUBLIC;
