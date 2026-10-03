-- "Expected outcome / next action" on a meeting task (ADR-036): what done looks
-- like, or the next step. Nullable, so tasks recorded before it existed are
-- untouched and the running code keeps working (expand only, §8.5).
ALTER TABLE "committees"."tasks" ADD COLUMN "expected_outcome" TEXT;

-- Absent is NULL, never an empty or blank string, and it stays a short note.
ALTER TABLE "committees"."tasks"
  ADD CONSTRAINT "tasks_expected_outcome_length"
    CHECK ("expected_outcome" IS NULL
      OR char_length(btrim("expected_outcome")) BETWEEN 1 AND 2000);
