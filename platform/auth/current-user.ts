import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { UnauthenticatedError } from "@/lib/errors";
import type { Actor } from "@/platform/authz/authz";
import { createServerSupabaseClient } from "@/platform/auth/supabase/server";
import { logger } from "@/platform/observability/logger";

/**
 * Who is making this request (CLAUDE.md §11.1).
 *
 * `iam.users.id` equals the Supabase `auth.users.id`. A verified Supabase session
 * whose IAM user row is missing, soft-deleted or deactivated is treated as
 * UNAUTHENTICATED — access is re-checked on every request, not only at sign-in.
 *
 * Deliberate divergence from the sibling CaptureERP project: there, a verified
 * session with no user row lazily creates one with a default role. TechVault does
 * NOT auto-provision. In an enterprise IAM, accounts are created deliberately —
 * by an administrator or by an `hris.EmployeeCreated` event — so a stray verified
 * identity can never obtain standing in the platform by simply signing in.
 */

export type CurrentUser = {
  id: string;
  email: string;
  fullName: string | null;
  locale: string;
  orgUnitId: string | null;
  orgUnitPath: string | null;
  hrisEmployeeId: string | null;
};

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (authUser === null) return null;

  const user = await prisma.user.findUnique({
    where: { id: authUser.id },
    select: {
      id: true,
      email: true,
      fullName: true,
      locale: true,
      isActive: true,
      deletedAt: true,
      orgUnitId: true,
      hrisEmployeeId: true,
      orgUnit: { select: { path: true } },
    },
  });

  if (user === null) {
    logger.warn("Verified session with no IAM user row — treating as anonymous", {
      module: "iam",
      operation: "auth.orphanSession",
      actorId: authUser.id,
    });
    return null;
  }

  if (!user.isActive || user.deletedAt !== null) {
    logger.info("Sign-in attempt by an inactive account", {
      module: "iam",
      operation: "auth.inactiveAccount",
      actorId: user.id,
    });
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    locale: user.locale,
    orgUnitId: user.orgUnitId,
    orgUnitPath: user.orgUnit?.path ?? null,
    hrisEmployeeId: user.hrisEmployeeId,
  };
});

/**
 * Requires an authenticated, active user, redirecting to sign-in otherwise.
 * Use at the top of protected pages and layouts.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (user === null) redirect("/login");
  return user;
}

/**
 * Requires an authenticated user, throwing rather than redirecting.
 * Use in Server Actions and route handlers, where a redirect would be wrong.
 */
export async function requireUserOrThrow(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (user === null) throw new UnauthenticatedError();
  return user;
}

/**
 * Builds the `Actor` passed to every service operation, carrying the request
 * context that audit records and denial logs need (§22).
 */
export async function getActor(): Promise<Actor> {
  const user = await requireUserOrThrow();
  const headerList = await headers();

  return {
    id: user.id,
    ipAddress: headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: headerList.get("user-agent"),
    correlationId: headerList.get("x-correlation-id"),
  };
}
