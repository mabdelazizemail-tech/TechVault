-- Close a real hole in the grant uniqueness constraints.
--
-- `iam.user_roles` declares @@unique([user_id, role_id, scope_type, scope_org_unit_id])
-- and `iam.user_permission_grants` declares a similar constraint. In SQL, NULL is
-- not equal to NULL, so a UNIQUE constraint containing a nullable column does NOT
-- prevent duplicate rows when that column is NULL.
--
-- `scope_org_unit_id` is NULL for every GLOBAL, OWN_ORG_UNIT and OWN scoped grant —
-- which is the common case. So the declared constraints silently permitted
-- duplicate grants exactly where duplicates are most likely: a double-submitted
-- "assign role" action. Duplicates are not a security hole on their own (the
-- evaluator is idempotent over grants), but they corrupt access review: "why does
-- this user have this permission?" gains phantom answers, and revoking one row
-- leaves the other in place.
--
-- Postgres cannot be told `UNIQUE NULLS NOT DISTINCT` through Prisma's schema
-- language, and Prisma does not support partial indexes, so these are declared
-- here as raw SQL. They live in the Prisma migration history (rather than in
-- supabase/migrations) so replaying history reproduces them and `migrate dev`
-- reports no drift.

-- One unscoped grant of a role per user.
CREATE UNIQUE INDEX "user_roles_unscoped_unique"
  ON "iam"."user_roles" ("user_id", "role_id", "scope_type")
  WHERE "scope_org_unit_id" IS NULL;

-- One unscoped direct grant per user, permission and effect. ALLOW and DENY are
-- separate rows by design: a DENY is an exception carved out of a role, and the
-- evaluator resolves the precedence.
CREATE UNIQUE INDEX "user_permission_grants_unscoped_unique"
  ON "iam"."user_permission_grants" ("user_id", "permission_id", "effect", "scope_type")
  WHERE "scope_org_unit_id" IS NULL;
