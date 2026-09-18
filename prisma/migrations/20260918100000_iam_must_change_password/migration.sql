-- An administrator may give an account a temporary password; the holder must then
-- choose their own before doing anything else. IAM checks this on every request,
-- like is_active, so it holds for every session of the account. Adding a column
-- with a constant default rewrites no rows.
ALTER TABLE "iam"."users" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;
