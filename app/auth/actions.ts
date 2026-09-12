"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { createServerSupabaseClient } from "@/platform/auth/supabase/server";
import { recordAuditSafely } from "@/platform/audit/audit";
import { logger } from "@/platform/observability/logger";

/**
 * Authentication actions (CLAUDE.md §11.1).
 *
 * Every attempt — successful or not — is recorded in `iam.login_history`, which
 * is what makes the "repeated failures" alert in §22 possible. The attempted
 * password is never stored, logged, or echoed back.
 */

export type SignInResult = { error: string } | undefined;

export async function signIn(formData: FormData): Promise<SignInResult> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/dashboard");

  if (email === "" || password === "") {
    return { error: "Enter your email address and password." };
  }

  const headerList = await headers();
  const ipAddress = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = headerList.get("user-agent");

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error !== null || data.user === null) {
    await recordLoginAttempt({
      email,
      success: false,
      failureReason: error?.message ?? "unknown",
      ipAddress,
      userAgent,
    });

    // Deliberately uniform: never reveal whether the address exists, or whether
    // it was the password that was wrong (CLAUDE.md §11.6).
    return { error: "Those credentials are not valid." };
  }

  await recordLoginAttempt({
    userId: data.user.id,
    email,
    success: true,
    ipAddress,
    userAgent,
  });

  // Only redirect to a local path — never to a target supplied in a query string
  // without validation, which would be an open redirect.
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
}

export async function signOut(): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  await supabase.auth.signOut();

  if (user !== null) {
    await recordAuditSafely({
      actorId: user.id,
      action: "iam.session.signed_out",
      module: "iam",
      entityType: "Session",
      entityId: null,
      summary: "Signed out",
    });
  }

  redirect("/login");
}

async function recordLoginAttempt(attempt: {
  userId?: string;
  email: string;
  success: boolean;
  failureReason?: string;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<void> {
  try {
    await prisma.loginHistory.create({
      data: {
        userId: attempt.userId ?? null,
        email: attempt.email,
        success: attempt.success,
        failureReason: attempt.failureReason ?? null,
        ipAddress: attempt.ipAddress,
        userAgent: attempt.userAgent,
      },
    });

    if (attempt.success && attempt.userId !== undefined) {
      await prisma.user.updateMany({
        where: { id: attempt.userId },
        data: { lastLoginAt: new Date() },
      });
    }
  } catch (error) {
    // Never convert an auth failure into a 500 because history could not be
    // written. The failure is logged instead.
    logger.error("Failed to record login attempt", {
      module: "iam",
      operation: "auth.recordLoginAttempt",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}
