-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "iam";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "platform";

-- CreateEnum
CREATE TYPE "iam"."PermissionAction" AS ENUM ('ACCESS', 'READ', 'CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'EXPORT', 'DOWNLOAD', 'SHARE', 'ADMINISTER');

-- CreateEnum
CREATE TYPE "iam"."ScopeType" AS ENUM ('GLOBAL', 'ORG_UNIT', 'OWN_ORG_UNIT', 'OWN');

-- CreateEnum
CREATE TYPE "iam"."GrantEffect" AS ENUM ('ALLOW', 'DENY');

-- CreateEnum
CREATE TYPE "iam"."PrincipalType" AS ENUM ('USER', 'SERVICE_ACCOUNT');

-- CreateEnum
CREATE TYPE "platform"."AuditSeverity" AS ENUM ('INFO', 'NOTICE', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "platform"."OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'DEAD');

-- CreateTable
CREATE TABLE "iam"."organizational_units" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_ar" TEXT,
    "parent_id" UUID,
    "path" TEXT NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "organizational_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "iam"."users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "org_unit_id" UUID,
    "hris_employee_id" UUID,
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "iam"."service_accounts" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,

    CONSTRAINT "service_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "iam"."permissions" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" "iam"."PermissionAction" NOT NULL,
    "description" TEXT NOT NULL,
    "is_sensitive" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "iam"."roles" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_ar" TEXT,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "iam"."role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "granted_by" UUID,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "iam"."user_roles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "scope_type" "iam"."ScopeType" NOT NULL DEFAULT 'GLOBAL',
    "scope_org_unit_id" UUID,
    "starts_at" TIMESTAMPTZ(6),
    "ends_at" TIMESTAMPTZ(6),
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "granted_by" UUID,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "iam"."user_permission_grants" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "effect" "iam"."GrantEffect" NOT NULL DEFAULT 'ALLOW',
    "scope_type" "iam"."ScopeType" NOT NULL DEFAULT 'GLOBAL',
    "scope_org_unit_id" UUID,
    "reason" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(6),
    "ends_at" TIMESTAMPTZ(6),
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "granted_by" UUID,

    CONSTRAINT "user_permission_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "iam"."service_account_roles" (
    "service_account_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "granted_by" UUID,

    CONSTRAINT "service_account_roles_pkey" PRIMARY KEY ("service_account_id","role_id")
);

-- CreateTable
CREATE TABLE "iam"."groups" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "iam"."group_members" (
    "group_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "added_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "added_by" UUID,

    CONSTRAINT "group_members_pkey" PRIMARY KEY ("group_id","user_id")
);

-- CreateTable
CREATE TABLE "iam"."group_roles" (
    "group_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "scope_type" "iam"."ScopeType" NOT NULL DEFAULT 'GLOBAL',
    "scope_org_unit_id" UUID,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "granted_by" UUID,

    CONSTRAINT "group_roles_pkey" PRIMARY KEY ("group_id","role_id","scope_type")
);

-- CreateTable
CREATE TABLE "iam"."api_tokens" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "principal_type" "iam"."PrincipalType" NOT NULL,
    "user_id" UUID,
    "service_account_id" UUID,
    "last_used_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "iam"."delegation_grants" (
    "id" UUID NOT NULL,
    "from_user_id" UUID NOT NULL,
    "to_user_id" UUID NOT NULL,
    "role_id" UUID,
    "reason" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "delegation_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "iam"."login_history" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "email" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "failure_reason" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "iam"."security_policies" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "security_policies_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "platform"."audit_log" (
    "id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "severity" "platform"."AuditSeverity" NOT NULL DEFAULT 'INFO',
    "actor_id" UUID,
    "actor_label" TEXT,
    "action" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "summary" TEXT NOT NULL,
    "changes" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "correlation_id" TEXT,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."event_outbox" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_id" UUID,
    "payload" JSONB NOT NULL,
    "correlation_id" TEXT,
    "status" "platform"."OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "event_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."app_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT NOT NULL,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "platform"."feature_flags" (
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "org_unit_ids" UUID[],
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizational_units_key_key" ON "iam"."organizational_units"("key");

-- CreateIndex
CREATE INDEX "organizational_units_parent_id_idx" ON "iam"."organizational_units"("parent_id");

-- CreateIndex
CREATE INDEX "organizational_units_path_idx" ON "iam"."organizational_units"("path");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "iam"."users"("email");

-- CreateIndex
CREATE INDEX "users_org_unit_id_idx" ON "iam"."users"("org_unit_id");

-- CreateIndex
CREATE INDEX "users_hris_employee_id_idx" ON "iam"."users"("hris_employee_id");

-- CreateIndex
CREATE INDEX "users_is_active_idx" ON "iam"."users"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "service_accounts_key_key" ON "iam"."service_accounts"("key");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "iam"."permissions"("key");

-- CreateIndex
CREATE INDEX "permissions_module_idx" ON "iam"."permissions"("module");

-- CreateIndex
CREATE INDEX "permissions_is_sensitive_idx" ON "iam"."permissions"("is_sensitive");

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "iam"."roles"("key");

-- CreateIndex
CREATE INDEX "role_permissions_permission_id_idx" ON "iam"."role_permissions"("permission_id");

-- CreateIndex
CREATE INDEX "user_roles_user_id_idx" ON "iam"."user_roles"("user_id");

-- CreateIndex
CREATE INDEX "user_roles_role_id_idx" ON "iam"."user_roles"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_user_id_role_id_scope_type_scope_org_unit_id_key" ON "iam"."user_roles"("user_id", "role_id", "scope_type", "scope_org_unit_id");

-- CreateIndex
CREATE INDEX "user_permission_grants_user_id_idx" ON "iam"."user_permission_grants"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_permission_grants_user_id_permission_id_effect_scope_t_key" ON "iam"."user_permission_grants"("user_id", "permission_id", "effect", "scope_type", "scope_org_unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "groups_key_key" ON "iam"."groups"("key");

-- CreateIndex
CREATE INDEX "group_members_user_id_idx" ON "iam"."group_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_tokens_token_hash_key" ON "iam"."api_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "api_tokens_user_id_idx" ON "iam"."api_tokens"("user_id");

-- CreateIndex
CREATE INDEX "api_tokens_service_account_id_idx" ON "iam"."api_tokens"("service_account_id");

-- CreateIndex
CREATE INDEX "api_tokens_expires_at_idx" ON "iam"."api_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "delegation_grants_to_user_id_starts_at_ends_at_idx" ON "iam"."delegation_grants"("to_user_id", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "login_history_user_id_occurred_at_idx" ON "iam"."login_history"("user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "login_history_email_occurred_at_idx" ON "iam"."login_history"("email", "occurred_at");

-- CreateIndex
CREATE INDEX "login_history_success_occurred_at_idx" ON "iam"."login_history"("success", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_actor_id_occurred_at_idx" ON "platform"."audit_log"("actor_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "platform"."audit_log"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_module_occurred_at_idx" ON "platform"."audit_log"("module", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_action_occurred_at_idx" ON "platform"."audit_log"("action", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_occurred_at_idx" ON "platform"."audit_log"("occurred_at");

-- CreateIndex
CREATE INDEX "event_outbox_status_available_at_idx" ON "platform"."event_outbox"("status", "available_at");

-- CreateIndex
CREATE INDEX "event_outbox_name_occurred_at_idx" ON "platform"."event_outbox"("name", "occurred_at");

-- AddForeignKey
ALTER TABLE "iam"."organizational_units" ADD CONSTRAINT "organizational_units_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "iam"."organizational_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iam"."users" ADD CONSTRAINT "users_org_unit_id_fkey" FOREIGN KEY ("org_unit_id") REFERENCES "iam"."organizational_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iam"."role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "iam"."roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iam"."role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "iam"."permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iam"."user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iam"."user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "iam"."roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iam"."user_roles" ADD CONSTRAINT "user_roles_scope_org_unit_id_fkey" FOREIGN KEY ("scope_org_unit_id") REFERENCES "iam"."organizational_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iam"."user_permission_grants" ADD CONSTRAINT "user_permission_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iam"."user_permission_grants" ADD CONSTRAINT "user_permission_grants_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "iam"."permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iam"."user_permission_grants" ADD CONSTRAINT "user_permission_grants_scope_org_unit_id_fkey" FOREIGN KEY ("scope_org_unit_id") REFERENCES "iam"."organizational_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iam"."service_account_roles" ADD CONSTRAINT "service_account_roles_service_account_id_fkey" FOREIGN KEY ("service_account_id") REFERENCES "iam"."service_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iam"."service_account_roles" ADD CONSTRAINT "service_account_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "iam"."roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iam"."group_members" ADD CONSTRAINT "group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "iam"."groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iam"."group_members" ADD CONSTRAINT "group_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iam"."group_roles" ADD CONSTRAINT "group_roles_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "iam"."groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iam"."group_roles" ADD CONSTRAINT "group_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "iam"."roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iam"."group_roles" ADD CONSTRAINT "group_roles_scope_org_unit_id_fkey" FOREIGN KEY ("scope_org_unit_id") REFERENCES "iam"."organizational_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iam"."api_tokens" ADD CONSTRAINT "api_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iam"."api_tokens" ADD CONSTRAINT "api_tokens_service_account_id_fkey" FOREIGN KEY ("service_account_id") REFERENCES "iam"."service_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iam"."delegation_grants" ADD CONSTRAINT "delegation_grants_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "iam"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iam"."delegation_grants" ADD CONSTRAINT "delegation_grants_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "iam"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iam"."delegation_grants" ADD CONSTRAINT "delegation_grants_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "iam"."roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iam"."login_history" ADD CONSTRAINT "login_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
