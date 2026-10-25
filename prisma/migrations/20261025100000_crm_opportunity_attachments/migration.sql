-- CreateEnum
CREATE TYPE "crm"."CrmAttachmentStatus" AS ENUM ('PENDING', 'READY');

-- CreateTable
CREATE TABLE "crm"."opportunity_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "opportunity_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "status" "crm"."CrmAttachmentStatus" NOT NULL DEFAULT 'PENDING',
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attached_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,

    CONSTRAINT "opportunity_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_attachments_storage_key_key" ON "crm"."opportunity_attachments"("storage_key");

-- CreateIndex
CREATE INDEX "opportunity_attachments_opportunity_id_idx" ON "crm"."opportunity_attachments"("opportunity_id");

-- AddForeignKey
ALTER TABLE "crm"."opportunity_attachments" ADD CONSTRAINT "opportunity_attachments_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "crm"."opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm"."opportunity_attachments" ADD CONSTRAINT "opportunity_attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm"."opportunity_attachments" ADD CONSTRAINT "opportunity_attachments_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Deal attachments (ADR-039): what must hold for every writer.
-- ---------------------------------------------------------------------------
ALTER TABLE "crm"."opportunity_attachments"
  ADD CONSTRAINT "opportunity_attachments_file_name_length"
    CHECK (length(btrim("file_name")) BETWEEN 1 AND 200),
  ADD CONSTRAINT "opportunity_attachments_content_type_length"
    CHECK (length("content_type") BETWEEN 1 AND 200),
  -- 25 MB, the platform's document limit (platform/storage/file-types.ts).
  ADD CONSTRAINT "opportunity_attachments_size"
    CHECK ("size_bytes" BETWEEN 1 AND 26214400),
  ADD CONSTRAINT "opportunity_attachments_attached_recorded"
    CHECK (("status" = 'READY') = ("attached_at" IS NOT NULL)),
  ADD CONSTRAINT "opportunity_attachments_removed_recorded"
    CHECK (("deleted_at" IS NULL) = ("deleted_by" IS NULL)),
  ADD CONSTRAINT "opportunity_attachments_removed_when_attached"
    CHECK ("deleted_at" IS NULL OR "status" = 'READY');

-- The files a deal page lists.
CREATE INDEX "opportunity_attachments_live_idx"
  ON "crm"."opportunity_attachments" ("opportunity_id", "attached_at")
  WHERE "status" = 'READY' AND "deleted_at" IS NULL;

-- A file's identity never changes; it is attached once and removed once; a removed
-- file stays on record. Only an upload that never got attached may be deleted.
CREATE OR REPLACE FUNCTION "crm"."opportunity_attachments_guard"()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'READY' THEN
      RAISE EXCEPTION 'crm: an attached file is never deleted; remove it from the deal instead';
    END IF;
    RETURN OLD;
  END IF;
  IF (NEW.opportunity_id, NEW.storage_key, NEW.file_name, NEW.content_type, NEW.size_bytes,
      NEW.uploaded_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.opportunity_id, OLD.storage_key, OLD.file_name, OLD.content_type, OLD.size_bytes,
      OLD.uploaded_by, OLD.created_at) THEN
    RAISE EXCEPTION 'crm: an attachment''s file cannot be changed';
  END IF;
  IF OLD.status = 'READY'
     AND (NEW.status, NEW.attached_at) IS DISTINCT FROM (OLD.status, OLD.attached_at) THEN
    RAISE EXCEPTION 'crm: an attached file stays attached';
  END IF;
  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'crm: a removed attachment cannot change';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION "crm"."opportunity_attachments_guard"() FROM PUBLIC;

CREATE TRIGGER "opportunity_attachments_guard"
  BEFORE UPDATE OR DELETE ON "crm"."opportunity_attachments"
  FOR EACH ROW
  EXECUTE FUNCTION "crm"."opportunity_attachments_guard"();

-- ---------------------------------------------------------------------------
-- Row-level security: deny by default, no policies (ADR-015)
-- ---------------------------------------------------------------------------
ALTER TABLE "crm"."opportunity_attachments" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE crm.opportunity_attachments FROM %I', api_role);
    END IF;
  END LOOP;
END $$;
