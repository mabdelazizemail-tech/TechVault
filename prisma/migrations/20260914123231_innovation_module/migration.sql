-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "innovation";

-- CreateEnum
CREATE TYPE "innovation"."InnovationCategoryKind" AS ENUM ('IDEA', 'KNOWLEDGE');

-- CreateEnum
CREATE TYPE "innovation"."InnovationIdeaStatus" AS ENUM ('NEW', 'REVIEWING', 'APPROVED', 'IN_PROGRESS', 'IMPLEMENTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "innovation"."InnovationProjectStatus" AS ENUM ('PLANNING', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "innovation"."InnovationFileStatus" AS ENUM ('PENDING', 'READY');

-- CreateTable
CREATE TABLE "innovation"."categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" "innovation"."InnovationCategoryKind" NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "innovation"."files" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "status" "innovation"."InnovationFileStatus" NOT NULL DEFAULT 'PENDING',
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "innovation"."ideas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category_id" UUID NOT NULL,
    "status" "innovation"."InnovationIdeaStatus" NOT NULL DEFAULT 'NEW',
    "owner_id" UUID,
    "attachment_file_id" UUID,
    "vote_count" INTEGER NOT NULL DEFAULT 0,
    "comment_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "ideas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "innovation"."idea_votes" (
    "idea_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idea_votes_pkey" PRIMARY KEY ("idea_id","user_id")
);

-- CreateTable
CREATE TABLE "innovation"."idea_comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "idea_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "idea_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "innovation"."knowledge_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category_id" UUID NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "file_id" UUID,
    "owner_id" UUID,
    "project_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "knowledge_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "innovation"."projects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "owner_id" UUID,
    "status" "innovation"."InnovationProjectStatus" NOT NULL DEFAULT 'PLANNING',
    "idea_id" UUID,
    "lessons_learned" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "innovation"."project_members" (
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("project_id","user_id")
);

-- CreateIndex
CREATE INDEX "categories_kind_is_active_sort_order_idx" ON "innovation"."categories"("kind", "is_active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "files_storage_key_key" ON "innovation"."files"("storage_key");

-- CreateIndex
CREATE INDEX "files_uploaded_by_status_idx" ON "innovation"."files"("uploaded_by", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ideas_attachment_file_id_key" ON "innovation"."ideas"("attachment_file_id");

-- CreateIndex
CREATE INDEX "ideas_status_created_at_idx" ON "innovation"."ideas"("status", "created_at");

-- CreateIndex
CREATE INDEX "ideas_category_id_idx" ON "innovation"."ideas"("category_id");

-- CreateIndex
CREATE INDEX "ideas_created_by_idx" ON "innovation"."ideas"("created_by");

-- CreateIndex
CREATE INDEX "ideas_owner_id_idx" ON "innovation"."ideas"("owner_id");

-- CreateIndex
CREATE INDEX "ideas_created_at_idx" ON "innovation"."ideas"("created_at");

-- CreateIndex
CREATE INDEX "idea_votes_user_id_idx" ON "innovation"."idea_votes"("user_id");

-- CreateIndex
CREATE INDEX "idea_comments_idea_id_created_at_idx" ON "innovation"."idea_comments"("idea_id", "created_at");

-- CreateIndex
CREATE INDEX "idea_comments_author_id_idx" ON "innovation"."idea_comments"("author_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_items_file_id_key" ON "innovation"."knowledge_items"("file_id");

-- CreateIndex
CREATE INDEX "knowledge_items_category_id_updated_at_idx" ON "innovation"."knowledge_items"("category_id", "updated_at");

-- CreateIndex
CREATE INDEX "knowledge_items_project_id_idx" ON "innovation"."knowledge_items"("project_id");

-- CreateIndex
CREATE INDEX "knowledge_items_owner_id_idx" ON "innovation"."knowledge_items"("owner_id");

-- CreateIndex
CREATE INDEX "knowledge_items_updated_at_idx" ON "innovation"."knowledge_items"("updated_at");

-- CreateIndex
CREATE INDEX "knowledge_items_tags_idx" ON "innovation"."knowledge_items" USING GIN ("tags");

-- CreateIndex
CREATE UNIQUE INDEX "projects_idea_id_key" ON "innovation"."projects"("idea_id");

-- CreateIndex
CREATE INDEX "projects_status_updated_at_idx" ON "innovation"."projects"("status", "updated_at");

-- CreateIndex
CREATE INDEX "projects_owner_id_idx" ON "innovation"."projects"("owner_id");

-- CreateIndex
CREATE INDEX "projects_updated_at_idx" ON "innovation"."projects"("updated_at");

-- CreateIndex
CREATE INDEX "project_members_user_id_idx" ON "innovation"."project_members"("user_id");

-- AddForeignKey
ALTER TABLE "innovation"."files" ADD CONSTRAINT "files_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "innovation"."ideas" ADD CONSTRAINT "ideas_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "innovation"."categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "innovation"."ideas" ADD CONSTRAINT "ideas_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "iam"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "innovation"."ideas" ADD CONSTRAINT "ideas_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "innovation"."ideas" ADD CONSTRAINT "ideas_attachment_file_id_fkey" FOREIGN KEY ("attachment_file_id") REFERENCES "innovation"."files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "innovation"."idea_votes" ADD CONSTRAINT "idea_votes_idea_id_fkey" FOREIGN KEY ("idea_id") REFERENCES "innovation"."ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "innovation"."idea_votes" ADD CONSTRAINT "idea_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "innovation"."idea_comments" ADD CONSTRAINT "idea_comments_idea_id_fkey" FOREIGN KEY ("idea_id") REFERENCES "innovation"."ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "innovation"."idea_comments" ADD CONSTRAINT "idea_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "innovation"."knowledge_items" ADD CONSTRAINT "knowledge_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "innovation"."categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "innovation"."knowledge_items" ADD CONSTRAINT "knowledge_items_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "innovation"."files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "innovation"."knowledge_items" ADD CONSTRAINT "knowledge_items_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "iam"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "innovation"."knowledge_items" ADD CONSTRAINT "knowledge_items_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "innovation"."projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "innovation"."projects" ADD CONSTRAINT "projects_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "iam"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "innovation"."projects" ADD CONSTRAINT "projects_idea_id_fkey" FOREIGN KEY ("idea_id") REFERENCES "innovation"."ideas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "innovation"."project_members" ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "innovation"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "innovation"."project_members" ADD CONSTRAINT "project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- Raw SQL below (ADR-021): search, invariants, the self-vote rule, row-level
-- security and the private storage bucket. Kept inside this migration so a replay
-- reproduces it (the ADR-014 precedent).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Full-text search
-- ---------------------------------------------------------------------------
-- The 'simple' configuration: no stemming or stop words, so English and Arabic
-- words are both indexed as written, and prefix queries ("depl:*") find partial
-- words. Each function is the one expression its index is built on; the services
-- query the same expression, which is what lets Postgres use the index.
CREATE OR REPLACE FUNCTION "innovation"."idea_search"(p_title text, p_description text)
  RETURNS tsvector
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
AS $$
  SELECT to_tsvector('simple', coalesce(p_title, '') || ' ' || coalesce(p_description, ''))
$$;

CREATE OR REPLACE FUNCTION "innovation"."knowledge_search"(
  p_title text,
  p_description text,
  p_tags text[]
)
  RETURNS tsvector
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
AS $$
  SELECT to_tsvector(
    'simple',
    coalesce(p_title, '') || ' ' || coalesce(p_description, '') || ' ' ||
    coalesce(array_to_string(p_tags, ' '), '')
  )
$$;

CREATE OR REPLACE FUNCTION "innovation"."project_search"(
  p_name text,
  p_description text,
  p_lessons text
)
  RETURNS tsvector
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
AS $$
  SELECT to_tsvector(
    'simple',
    coalesce(p_name, '') || ' ' || coalesce(p_description, '') || ' ' || coalesce(p_lessons, '')
  )
$$;

CREATE INDEX "ideas_search_idx" ON "innovation"."ideas"
  USING gin ("innovation"."idea_search"("title", "description"))
  WHERE "deleted_at" IS NULL;

CREATE INDEX "knowledge_items_search_idx" ON "innovation"."knowledge_items"
  USING gin ("innovation"."knowledge_search"("title", "description", "tags"))
  WHERE "deleted_at" IS NULL;

CREATE INDEX "projects_search_idx" ON "innovation"."projects"
  USING gin ("innovation"."project_search"("name", "description", "lessons_learned"))
  WHERE "deleted_at" IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Invariants
-- ---------------------------------------------------------------------------
ALTER TABLE "innovation"."categories"
  ADD CONSTRAINT "categories_name_length" CHECK (char_length("name") BETWEEN 1 AND 60);

-- One category of a kind per name, whatever the capitalisation.
CREATE UNIQUE INDEX "categories_kind_name_key"
  ON "innovation"."categories" ("kind", lower("name"));

ALTER TABLE "innovation"."files"
  ADD CONSTRAINT "files_size_range" CHECK ("size_bytes" BETWEEN 1 AND 26214400),
  ADD CONSTRAINT "files_name_length" CHECK (char_length("file_name") BETWEEN 1 AND 255);

ALTER TABLE "innovation"."ideas"
  ADD CONSTRAINT "ideas_title_length" CHECK (char_length("title") BETWEEN 1 AND 160),
  ADD CONSTRAINT "ideas_description_length" CHECK (char_length("description") BETWEEN 1 AND 5000),
  ADD CONSTRAINT "ideas_counts_non_negative" CHECK ("vote_count" >= 0 AND "comment_count" >= 0);

ALTER TABLE "innovation"."idea_comments"
  ADD CONSTRAINT "idea_comments_body_length" CHECK (char_length("body") BETWEEN 1 AND 2000);

ALTER TABLE "innovation"."knowledge_items"
  ADD CONSTRAINT "knowledge_items_title_length" CHECK (char_length("title") BETWEEN 1 AND 200),
  ADD CONSTRAINT "knowledge_items_description_length"
    CHECK ("description" IS NULL OR char_length("description") <= 4000),
  ADD CONSTRAINT "knowledge_items_tag_count" CHECK (cardinality("tags") <= 12),
  ADD CONSTRAINT "knowledge_items_has_content"
    CHECK ("description" IS NOT NULL OR "file_id" IS NOT NULL);

ALTER TABLE "innovation"."projects"
  ADD CONSTRAINT "projects_name_length" CHECK (char_length("name") BETWEEN 1 AND 160);

-- Nobody votes for their own idea — enforced for every connection, the
-- application's included (CLAUDE.md §6.6). No custom ERRCODE, so Prisma surfaces
-- the message.
CREATE OR REPLACE FUNCTION "innovation"."idea_votes_not_own"()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM innovation.ideas i
     WHERE i.id = NEW.idea_id AND i.created_by = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'innovation: people cannot vote for their own ideas';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "idea_votes_not_own"
  BEFORE INSERT ON "innovation"."idea_votes"
  FOR EACH ROW
  EXECUTE FUNCTION "innovation"."idea_votes_not_own"();

-- ---------------------------------------------------------------------------
-- 3. Row-level security: deny by default, no policies (ADR-015)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  target record;
  api_role text;
BEGIN
  FOR target IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'innovation' ORDER BY tablename
  LOOP
    EXECUTE format('ALTER TABLE innovation.%I ENABLE ROW LEVEL SECURITY', target.tablename);
  END LOOP;

  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA innovation FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA innovation FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA innovation FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL ROUTINES IN SCHEMA innovation FROM %I', api_role);
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA innovation REVOKE ALL ON TABLES FROM %I',
        api_role
      );
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 4. The private storage bucket (Supabase only)
-- ---------------------------------------------------------------------------
-- Private, and with NO policies on storage.objects: no client key can list, read
-- or write it. Only the server, holding SUPABASE_SECRET_KEY, reaches it, after the
-- application has authorised the request (§12.3). The name matches the
-- STORAGE_BUCKET default in platform/config/env.ts; the size limit matches
-- MAX_FILE_BYTES in modules/innovation/domain/files.ts. Skipped on plain Postgres.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'Supabase Storage not present; skipping the documents bucket.';
    RETURN;
  END IF;
  INSERT INTO storage.buckets (id, name, public, file_size_limit)
  VALUES ('techvault-documents', 'techvault-documents', false, 26214400)
  ON CONFLICT (id) DO NOTHING;
END $$;
