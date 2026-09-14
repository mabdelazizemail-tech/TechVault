-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "crm";

-- CreateEnum
CREATE TYPE "crm"."CrmCurrency" AS ENUM ('EGP', 'USD');

-- CreateEnum
CREATE TYPE "crm"."CrmLeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'DISQUALIFIED');

-- CreateEnum
CREATE TYPE "crm"."CrmLeadSource" AS ENUM ('WEBSITE', 'REFERRAL', 'LINKEDIN', 'ADVERTISEMENT', 'EVENT', 'COLD_OUTREACH', 'PARTNER', 'OTHER');

-- CreateEnum
CREATE TYPE "crm"."CrmPurchaseTimeline" AS ENUM ('IMMEDIATE', 'WITHIN_3_MONTHS', 'WITHIN_6_MONTHS', 'WITHIN_12_MONTHS', 'OVER_12_MONTHS', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "crm"."CrmDecisionMaker" AS ENUM ('YES', 'NO', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "crm"."CrmSalesChannel" AS ENUM ('DIRECT', 'INDIRECT');

-- CreateEnum
CREATE TYPE "crm"."CrmStageKind" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "crm"."CrmOpportunityStatus" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "crm"."CrmPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "crm"."CrmLostReason" AS ENUM ('PRICE', 'COMPETITOR', 'NO_BUDGET', 'TIMING', 'NO_DECISION', 'PRODUCT_FIT', 'OTHER');

-- CreateEnum
CREATE TYPE "crm"."CrmActivityType" AS ENUM ('CALL', 'EMAIL', 'MEETING', 'TASK', 'NOTE', 'STATUS_CHANGE', 'STAGE_CHANGE');

-- CreateTable
CREATE TABLE "crm"."accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "website" TEXT,
    "industry" TEXT,
    "company_size" TEXT,
    "country" TEXT,
    "city" TEXT,
    "phone" TEXT,
    "description" TEXT,
    "owner_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm"."contacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "job_title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "country" TEXT,
    "city" TEXT,
    "account_id" UUID,
    "owner_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm"."leads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "job_title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "source" "crm"."CrmLeadSource" NOT NULL,
    "industry" TEXT,
    "company_size" TEXT,
    "country" TEXT,
    "city" TEXT,
    "interest" TEXT,
    "budget_minor" INTEGER,
    "currency" "crm"."CrmCurrency" NOT NULL DEFAULT 'EGP',
    "timeline" "crm"."CrmPurchaseTimeline",
    "decision_maker" "crm"."CrmDecisionMaker",
    "current_solution" TEXT,
    "pain_point" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,
    "status" "crm"."CrmLeadStatus" NOT NULL DEFAULT 'NEW',
    "status_changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "owner_id" UUID,
    "converted_at" TIMESTAMPTZ(6),
    "converted_account_id" UUID,
    "converted_contact_id" UUID,
    "converted_opportunity_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm"."opportunity_stages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "crm"."CrmStageKind" NOT NULL DEFAULT 'OPEN',
    "default_probability" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "opportunity_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm"."opportunities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "account_id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "status" "crm"."CrmOpportunityStatus" NOT NULL DEFAULT 'OPEN',
    "amount_minor" INTEGER NOT NULL,
    "currency" "crm"."CrmCurrency" NOT NULL DEFAULT 'EGP',
    "close_date" DATE NOT NULL,
    "probability" INTEGER NOT NULL DEFAULT 0,
    "priority" "crm"."CrmPriority" NOT NULL DEFAULT 'MEDIUM',
    "channel" "crm"."CrmSalesChannel" NOT NULL DEFAULT 'DIRECT',
    "partner_name" TEXT,
    "source" "crm"."CrmLeadSource",
    "product" TEXT,
    "description" TEXT,
    "owner_id" UUID,
    "stage_changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "won_at" TIMESTAMPTZ(6),
    "lost_at" TIMESTAMPTZ(6),
    "lost_reason" "crm"."CrmLostReason",
    "close_notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm"."opportunity_contacts" (
    "opportunity_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opportunity_contacts_pkey" PRIMARY KEY ("opportunity_id","contact_id")
);

-- CreateTable
CREATE TABLE "crm"."activities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" "crm"."CrmActivityType" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duration_minutes" INTEGER,
    "due_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "priority" "crm"."CrmPriority",
    "assignee_id" UUID,
    "lead_id" UUID,
    "account_id" UUID,
    "contact_id" UUID,
    "opportunity_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accounts_owner_id_idx" ON "crm"."accounts"("owner_id");

-- CreateIndex
CREATE INDEX "accounts_name_idx" ON "crm"."accounts"("name");

-- CreateIndex
CREATE INDEX "accounts_deleted_at_idx" ON "crm"."accounts"("deleted_at");

-- CreateIndex
CREATE INDEX "contacts_account_id_idx" ON "crm"."contacts"("account_id");

-- CreateIndex
CREATE INDEX "contacts_owner_id_idx" ON "crm"."contacts"("owner_id");

-- CreateIndex
CREATE INDEX "contacts_last_name_first_name_idx" ON "crm"."contacts"("last_name", "first_name");

-- CreateIndex
CREATE INDEX "contacts_deleted_at_idx" ON "crm"."contacts"("deleted_at");

-- CreateIndex
CREATE INDEX "leads_status_idx" ON "crm"."leads"("status");

-- CreateIndex
CREATE INDEX "leads_owner_id_idx" ON "crm"."leads"("owner_id");

-- CreateIndex
CREATE INDEX "leads_source_idx" ON "crm"."leads"("source");

-- CreateIndex
CREATE INDEX "leads_created_at_idx" ON "crm"."leads"("created_at");

-- CreateIndex
CREATE INDEX "leads_deleted_at_idx" ON "crm"."leads"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_stages_key_key" ON "crm"."opportunity_stages"("key");

-- CreateIndex
CREATE INDEX "opportunity_stages_position_idx" ON "crm"."opportunity_stages"("position");

-- CreateIndex
CREATE INDEX "opportunities_stage_id_idx" ON "crm"."opportunities"("stage_id");

-- CreateIndex
CREATE INDEX "opportunities_account_id_idx" ON "crm"."opportunities"("account_id");

-- CreateIndex
CREATE INDEX "opportunities_owner_id_idx" ON "crm"."opportunities"("owner_id");

-- CreateIndex
CREATE INDEX "opportunities_status_close_date_idx" ON "crm"."opportunities"("status", "close_date");

-- CreateIndex
CREATE INDEX "opportunities_deleted_at_idx" ON "crm"."opportunities"("deleted_at");

-- CreateIndex
CREATE INDEX "opportunity_contacts_contact_id_idx" ON "crm"."opportunity_contacts"("contact_id");

-- CreateIndex
CREATE INDEX "activities_lead_id_occurred_at_idx" ON "crm"."activities"("lead_id", "occurred_at");

-- CreateIndex
CREATE INDEX "activities_account_id_occurred_at_idx" ON "crm"."activities"("account_id", "occurred_at");

-- CreateIndex
CREATE INDEX "activities_contact_id_occurred_at_idx" ON "crm"."activities"("contact_id", "occurred_at");

-- CreateIndex
CREATE INDEX "activities_opportunity_id_occurred_at_idx" ON "crm"."activities"("opportunity_id", "occurred_at");

-- CreateIndex
CREATE INDEX "activities_type_due_at_idx" ON "crm"."activities"("type", "due_at");

-- CreateIndex
CREATE INDEX "activities_assignee_id_idx" ON "crm"."activities"("assignee_id");

-- CreateIndex
CREATE INDEX "activities_deleted_at_idx" ON "crm"."activities"("deleted_at");

-- AddForeignKey
ALTER TABLE "crm"."accounts" ADD CONSTRAINT "accounts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "iam"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm"."contacts" ADD CONSTRAINT "contacts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "crm"."accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm"."contacts" ADD CONSTRAINT "contacts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "iam"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm"."leads" ADD CONSTRAINT "leads_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "iam"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm"."leads" ADD CONSTRAINT "leads_converted_account_id_fkey" FOREIGN KEY ("converted_account_id") REFERENCES "crm"."accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm"."leads" ADD CONSTRAINT "leads_converted_contact_id_fkey" FOREIGN KEY ("converted_contact_id") REFERENCES "crm"."contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm"."leads" ADD CONSTRAINT "leads_converted_opportunity_id_fkey" FOREIGN KEY ("converted_opportunity_id") REFERENCES "crm"."opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm"."opportunities" ADD CONSTRAINT "opportunities_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "crm"."accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm"."opportunities" ADD CONSTRAINT "opportunities_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "crm"."opportunity_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm"."opportunities" ADD CONSTRAINT "opportunities_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "iam"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm"."opportunity_contacts" ADD CONSTRAINT "opportunity_contacts_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "crm"."opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm"."opportunity_contacts" ADD CONSTRAINT "opportunity_contacts_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "crm"."contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm"."activities" ADD CONSTRAINT "activities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "crm"."leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm"."activities" ADD CONSTRAINT "activities_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "crm"."accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm"."activities" ADD CONSTRAINT "activities_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "crm"."contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm"."activities" ADD CONSTRAINT "activities_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "crm"."opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm"."activities" ADD CONSTRAINT "activities_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "iam"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm"."activities" ADD CONSTRAINT "activities_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "iam"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ===========================================================================
-- Invariants the Prisma schema language cannot express (CLAUDE.md §8.4).
-- The application checks these too; the database is the last line of defence.
-- ===========================================================================

ALTER TABLE "crm"."leads"
  ADD CONSTRAINT "leads_score_range" CHECK ("score" BETWEEN 0 AND 100),
  ADD CONSTRAINT "leads_budget_non_negative" CHECK ("budget_minor" IS NULL OR "budget_minor" >= 0);

ALTER TABLE "crm"."opportunity_stages"
  ADD CONSTRAINT "opportunity_stages_probability_range"
    CHECK ("default_probability" BETWEEN 0 AND 100);

ALTER TABLE "crm"."opportunities"
  ADD CONSTRAINT "opportunities_amount_non_negative" CHECK ("amount_minor" >= 0),
  ADD CONSTRAINT "opportunities_probability_range" CHECK ("probability" BETWEEN 0 AND 100),
  -- An indirect deal names its channel partner.
  ADD CONSTRAINT "opportunities_partner_for_indirect"
    CHECK ("channel" = 'DIRECT' OR "partner_name" IS NOT NULL),
  -- A won deal has a win date; a lost deal has a loss date AND a reason; an open
  -- deal has neither. The lost reason is the data a sales team needs later.
  ADD CONSTRAINT "opportunities_close_details" CHECK (
    ("status" = 'OPEN' AND "won_at" IS NULL AND "lost_at" IS NULL)
    OR ("status" = 'WON' AND "won_at" IS NOT NULL)
    OR ("status" = 'LOST' AND "lost_at" IS NOT NULL AND "lost_reason" IS NOT NULL)
  );

ALTER TABLE "crm"."activities"
  -- Every activity belongs to at least one CRM record.
  ADD CONSTRAINT "activities_linked_to_a_record"
    CHECK (num_nonnulls("lead_id", "account_id", "contact_id", "opportunity_id") >= 1),
  ADD CONSTRAINT "activities_duration_non_negative"
    CHECK ("duration_minutes" IS NULL OR "duration_minutes" >= 0);

-- One live company per name and one live contact per email, case-insensitively.
-- This is what makes "do not duplicate existing accounts or contacts" hold under
-- a race, not just on the happy path.
CREATE UNIQUE INDEX "accounts_name_live_unique"
  ON "crm"."accounts" (lower("name")) WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX "contacts_email_live_unique"
  ON "crm"."contacts" (lower("email")) WHERE "email" IS NOT NULL AND "deleted_at" IS NULL;

-- At most one primary contact per opportunity.
CREATE UNIQUE INDEX "opportunity_contacts_one_primary"
  ON "crm"."opportunity_contacts" ("opportunity_id") WHERE "is_primary";

-- ===========================================================================
-- Row-level security deny-by-default (ADR-015): tables get RLS in the migration
-- that creates them. The app connects as the table owner and is unaffected.
-- ===========================================================================

DO $$
DECLARE
  target record;
BEGIN
  FOR target IN SELECT tablename FROM pg_tables WHERE schemaname = 'crm' LOOP
    EXECUTE format('ALTER TABLE crm.%I ENABLE ROW LEVEL SECURITY', target.tablename);
  END LOOP;
END $$;

DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA crm FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA crm FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA crm FROM %I', api_role);
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA crm REVOKE ALL ON TABLES FROM %I', api_role
      );
    END IF;
  END LOOP;
END $$;
