-- A mission expense may be submitted without a picture of its receipt (ADR-037,
-- changed at the owner's request). The unique index on receipt_id stays: a picture
-- still belongs to one claim at most, and NULLs never collide.
-- AlterTable
ALTER TABLE "committees"."mission_expenses" ALTER COLUMN "receipt_id" DROP NOT NULL;
