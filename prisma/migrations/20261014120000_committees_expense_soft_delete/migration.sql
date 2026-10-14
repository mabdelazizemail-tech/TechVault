-- AlterTable
ALTER TABLE "committees"."mission_expenses" ADD COLUMN     "deleted_at" TIMESTAMPTZ(6),
ADD COLUMN     "deleted_by" UUID;

-- AddForeignKey
ALTER TABLE "committees"."mission_expenses" ADD CONSTRAINT "mission_expenses_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Administrators delete a claim by marking it deleted (ADR-037). The row stays,
-- so the audit trail and the receipt keep pointing at something real.
-- ---------------------------------------------------------------------------
ALTER TABLE "committees"."mission_expenses"
  ADD CONSTRAINT "mission_expenses_deleted_recorded"
  CHECK ((deleted_at IS NULL) = (deleted_by IS NULL));

-- Replaces the guard of 20261014100000: a claim's own fields never change; a
-- claim is reviewed once; marking it deleted is allowed whatever its status but
-- changes nothing else; a deleted claim never changes again (no undelete); and a
-- row is never removed from the table.
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
  IF NEW.deleted_at IS NOT NULL THEN
    IF (NEW.status, NEW.reviewed_by, NEW.reviewed_at, NEW.review_note)
       IS DISTINCT FROM
       (OLD.status, OLD.reviewed_by, OLD.reviewed_at, OLD.review_note) THEN
      RAISE EXCEPTION 'committees: deleting a mission expense cannot also review it';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION 'committees: a reviewed mission expense cannot change';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION "committees"."mission_expenses_guard"() FROM PUBLIC;
