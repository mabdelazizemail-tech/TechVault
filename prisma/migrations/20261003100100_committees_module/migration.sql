-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "committees";

-- CreateEnum
CREATE TYPE "committees"."CommitteeTaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "committees"."committees" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "committees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "committees"."committee_members" (
    "committee_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "committee_members_pkey" PRIMARY KEY ("committee_id","user_id")
);

-- CreateTable
CREATE TABLE "committees"."meetings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "committee_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "scheduled_at" TIMESTAMPTZ(6) NOT NULL,
    "location" TEXT,
    "description" TEXT,
    "organizer_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "committees"."agenda_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "meeting_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "agenda_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "committees"."tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "meeting_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "due_date" DATE NOT NULL,
    "status" "committees"."CommitteeTaskStatus" NOT NULL DEFAULT 'PENDING',
    "completed_at" TIMESTAMPTZ(6),
    "reply_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "committees"."task_assignees" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "task_id" UUID NOT NULL,
    "user_id" UUID,
    "manual_name" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "task_assignees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "committees"."task_replies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "task_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT,
    "status_from" "committees"."CommitteeTaskStatus",
    "status_to" "committees"."CommitteeTaskStatus",
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_replies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "committees_is_active_name_idx" ON "committees"."committees"("is_active", "name");

-- CreateIndex
CREATE INDEX "committee_members_user_id_idx" ON "committees"."committee_members"("user_id");

-- CreateIndex
CREATE INDEX "meetings_committee_id_scheduled_at_idx" ON "committees"."meetings"("committee_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "meetings_organizer_id_idx" ON "committees"."meetings"("organizer_id");

-- CreateIndex
CREATE INDEX "meetings_scheduled_at_idx" ON "committees"."meetings"("scheduled_at");

-- CreateIndex
CREATE INDEX "agenda_items_meeting_id_position_idx" ON "committees"."agenda_items"("meeting_id", "position");

-- CreateIndex
CREATE INDEX "tasks_meeting_id_due_date_idx" ON "committees"."tasks"("meeting_id", "due_date");

-- CreateIndex
CREATE INDEX "tasks_status_due_date_idx" ON "committees"."tasks"("status", "due_date");

-- CreateIndex
CREATE INDEX "tasks_due_date_idx" ON "committees"."tasks"("due_date");

-- CreateIndex
CREATE INDEX "tasks_created_by_idx" ON "committees"."tasks"("created_by");

-- CreateIndex
CREATE INDEX "task_assignees_task_id_idx" ON "committees"."task_assignees"("task_id");

-- CreateIndex
CREATE INDEX "task_assignees_user_id_idx" ON "committees"."task_assignees"("user_id");

-- CreateIndex
CREATE INDEX "task_replies_task_id_created_at_id_idx" ON "committees"."task_replies"("task_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "task_replies_author_id_idx" ON "committees"."task_replies"("author_id");

-- AddForeignKey
ALTER TABLE "committees"."committee_members" ADD CONSTRAINT "committee_members_committee_id_fkey" FOREIGN KEY ("committee_id") REFERENCES "committees"."committees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "committees"."committee_members" ADD CONSTRAINT "committee_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "committees"."meetings" ADD CONSTRAINT "meetings_committee_id_fkey" FOREIGN KEY ("committee_id") REFERENCES "committees"."committees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "committees"."meetings" ADD CONSTRAINT "meetings_organizer_id_fkey" FOREIGN KEY ("organizer_id") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "committees"."agenda_items" ADD CONSTRAINT "agenda_items_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "committees"."meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "committees"."tasks" ADD CONSTRAINT "tasks_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "committees"."meetings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "committees"."tasks" ADD CONSTRAINT "tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "committees"."task_assignees" ADD CONSTRAINT "task_assignees_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "committees"."tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "committees"."task_assignees" ADD CONSTRAINT "task_assignees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "committees"."task_replies" ADD CONSTRAINT "task_replies_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "committees"."tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "committees"."task_replies" ADD CONSTRAINT "task_replies_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 1. Invariants Prisma cannot express (ADR-036)
-- ---------------------------------------------------------------------------
ALTER TABLE "committees"."committees"
  ADD CONSTRAINT "committees_name_length"
    CHECK (char_length(btrim("name")) BETWEEN 1 AND 120),
  ADD CONSTRAINT "committees_description_length"
    CHECK ("description" IS NULL OR char_length("description") <= 2000);

-- One live committee per name, ignoring case and surrounding spaces.
CREATE UNIQUE INDEX "committees_name_live_key"
  ON "committees"."committees" (lower(btrim("name")))
  WHERE "deleted_at" IS NULL;

ALTER TABLE "committees"."meetings"
  ADD CONSTRAINT "meetings_title_length"
    CHECK (char_length(btrim("title")) BETWEEN 1 AND 200),
  ADD CONSTRAINT "meetings_location_length"
    CHECK ("location" IS NULL OR char_length("location") <= 200),
  ADD CONSTRAINT "meetings_description_length"
    CHECK ("description" IS NULL OR char_length("description") <= 5000);

ALTER TABLE "committees"."agenda_items"
  ADD CONSTRAINT "agenda_items_position_nonnegative" CHECK ("position" >= 0),
  ADD CONSTRAINT "agenda_items_title_length"
    CHECK (char_length(btrim("title")) BETWEEN 1 AND 200),
  ADD CONSTRAINT "agenda_items_notes_length"
    CHECK ("notes" IS NULL OR char_length("notes") <= 5000);

-- A task is Completed exactly when it has a completion time; Overdue is never
-- stored, it is derived from the due date.
ALTER TABLE "committees"."tasks"
  ADD CONSTRAINT "tasks_description_length"
    CHECK (char_length(btrim("description")) BETWEEN 1 AND 5000),
  ADD CONSTRAINT "tasks_due_date_range"
    CHECK ("due_date" BETWEEN DATE '2000-01-01' AND DATE '2100-12-31'),
  ADD CONSTRAINT "tasks_completed_matches_status"
    CHECK (("status" = 'COMPLETED') = ("completed_at" IS NOT NULL)),
  ADD CONSTRAINT "tasks_reply_count_nonnegative" CHECK ("reply_count" >= 0);

-- A responsible person is a registered user OR a typed name, never both, never
-- neither; and nobody is listed twice on one task.
ALTER TABLE "committees"."task_assignees"
  ADD CONSTRAINT "task_assignees_user_or_name"
    CHECK (num_nonnulls("user_id", "manual_name") = 1),
  ADD CONSTRAINT "task_assignees_manual_name_length"
    CHECK ("manual_name" IS NULL OR char_length(btrim("manual_name")) BETWEEN 1 AND 120);

CREATE UNIQUE INDEX "task_assignees_task_user_key"
  ON "committees"."task_assignees" ("task_id", "user_id")
  WHERE "user_id" IS NOT NULL;

CREATE UNIQUE INDEX "task_assignees_task_manual_name_key"
  ON "committees"."task_assignees" ("task_id", lower(btrim("manual_name")))
  WHERE "manual_name" IS NOT NULL;

-- An entry in a task's discussion is a reply, a status change, or both. A status
-- change records where it came from and went to, and must actually change it.
ALTER TABLE "committees"."task_replies"
  ADD CONSTRAINT "task_replies_body_length"
    CHECK ("body" IS NULL OR char_length(btrim("body")) BETWEEN 1 AND 5000),
  ADD CONSTRAINT "task_replies_status_pair"
    CHECK (("status_from" IS NULL) = ("status_to" IS NULL)),
  ADD CONSTRAINT "task_replies_status_changes"
    CHECK ("status_to" IS NULL OR "status_from" <> "status_to"),
  ADD CONSTRAINT "task_replies_not_empty"
    CHECK ("body" IS NOT NULL OR "status_to" IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 2. The discussion is append-only; its reply count is kept by the database
-- ---------------------------------------------------------------------------
-- "Maintain a complete history of task discussions": no writer, the owner
-- connection included, may edit or remove an entry. TRUNCATE stays open for the
-- integration suite's resets, as on platform.audit_log (ADR-015).
CREATE OR REPLACE FUNCTION "committees"."task_replies_append_only"()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'committees: task discussion entries cannot be changed or removed';
END;
$$;

CREATE TRIGGER "task_replies_append_only"
  BEFORE UPDATE OR DELETE ON "committees"."task_replies"
  FOR EACH ROW
  EXECUTE FUNCTION "committees"."task_replies_append_only"();

-- Counts replies with text (a bare status change is not a reply), whoever writes
-- them, without touching the task's updated_at — a reply is not an edit.
CREATE OR REPLACE FUNCTION "committees"."task_replies_count"()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
BEGIN
  IF NEW.body IS NOT NULL THEN
    UPDATE committees.tasks SET reply_count = reply_count + 1 WHERE id = NEW.task_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "task_replies_count"
  AFTER INSERT ON "committees"."task_replies"
  FOR EACH ROW
  EXECUTE FUNCTION "committees"."task_replies_count"();

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "committees" FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 3. Row-level security: deny by default, no policies (ADR-015)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  target record;
  api_role text;
BEGIN
  FOR target IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'committees' ORDER BY tablename
  LOOP
    EXECUTE format('ALTER TABLE committees.%I ENABLE ROW LEVEL SECURITY', target.tablename);
  END LOOP;

  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA committees FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA committees FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA committees FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL ROUTINES IN SCHEMA committees FROM %I', api_role);
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA committees REVOKE ALL ON TABLES FROM %I',
        api_role
      );
    END IF;
  END LOOP;
END $$;
