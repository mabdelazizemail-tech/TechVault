-- Mission expenses in USD (ADR-038): each claim keeps the exchange rate it was
-- converted at, fixed once, and the database derives the USD amount from it.

-- AlterTable
ALTER TABLE "committees"."mission_expenses"
  ADD COLUMN "usd_rate" DECIMAL(20,10),
  ADD COLUMN "usd_rate_at" TIMESTAMPTZ(6),
  ADD COLUMN "usd_rate_source" VARCHAR(40),
  ADD COLUMN "usd_converted_at" TIMESTAMPTZ(6),
  -- usd_rate is units of the claim's currency per 1 USD; round() on numeric rounds
  -- half away from zero. Generated, so no writer can store a USD figure that does
  -- not follow from the amount and the rate.
  ADD COLUMN "amount_usd_minor" BIGINT
    GENERATED ALWAYS AS (round("amount_minor" / "usd_rate")::bigint) STORED;

ALTER TABLE "committees"."mission_expenses"
  ADD CONSTRAINT "mission_expenses_usd_recorded"
    CHECK (num_nulls("usd_rate", "usd_rate_at", "usd_rate_source", "usd_converted_at") IN (0, 4)),
  ADD CONSTRAINT "mission_expenses_usd_rate_positive"
    CHECK ("usd_rate" IS NULL OR "usd_rate" > 0),
  ADD CONSTRAINT "mission_expenses_usd_par"
    CHECK ("currency" <> 'USD' OR "usd_rate" IS NULL OR "usd_rate" = 1),
  ADD CONSTRAINT "mission_expenses_usd_source"
    CHECK ("usd_rate_source" IS NULL OR length(btrim("usd_rate_source")) BETWEEN 1 AND 40);

-- The claims still waiting for a rate, found on every page that shows USD totals.
CREATE INDEX "mission_expenses_usd_pending_idx"
  ON "committees"."mission_expenses" ("created_at")
  WHERE "usd_rate" IS NULL AND "deleted_at" IS NULL;

-- Replaces the guard of 20261014120000. Unchanged: a claim's own fields never
-- change, a claim is reviewed once, deleting it changes nothing else, a deleted
-- claim never changes again, and no row is removed. New: the USD conversion may be
-- added once — also to a claim already reviewed, since a claim submitted while the
-- rate service was unreachable is converted later — and never changed or cleared.
CREATE OR REPLACE FUNCTION "committees"."mission_expenses_guard"()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
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
  IF NEW.deleted_at IS NOT NULL THEN
    IF (NEW.status, NEW.reviewed_by, NEW.reviewed_at, NEW.review_note)
       IS DISTINCT FROM
       (OLD.status, OLD.reviewed_by, OLD.reviewed_at, OLD.review_note) THEN
      RAISE EXCEPTION 'committees: deleting a mission expense cannot also review it';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'SUBMITTED'
     AND (NEW.status, NEW.reviewed_by, NEW.reviewed_at, NEW.review_note)
         IS DISTINCT FROM
         (OLD.status, OLD.reviewed_by, OLD.reviewed_at, OLD.review_note) THEN
    RAISE EXCEPTION 'committees: a reviewed mission expense cannot change';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION "committees"."mission_expenses_guard"() FROM PUBLIC;
