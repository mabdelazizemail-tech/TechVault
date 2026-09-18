-- People sign in with a username and a password; an email address is optional
-- (ADR-035). The username is stored in lower case and is never reused, deleted
-- accounts included, so the audit trail keeps pointing at one person.
ALTER TABLE "iam"."users" ADD COLUMN "username" TEXT;

ALTER TABLE "iam"."users"
  ADD CONSTRAINT "users_username_format"
  CHECK ("username" IS NULL OR "username" ~ '^[a-z0-9][a-z0-9._-]{2,31}$');

CREATE UNIQUE INDEX "users_username_unique"
  ON "iam"."users" ("username")
  WHERE "username" IS NOT NULL;
