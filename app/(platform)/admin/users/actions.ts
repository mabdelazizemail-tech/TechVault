"use server";

import { revalidatePath } from "next/cache";
import { isAppError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/platform/authz/authz";
import { getActor } from "@/platform/auth/current-user";
import {
  createUser,
  deleteUser,
  requestPasswordReset,
  setUserPassword,
  setUserRoles,
  updateUser,
  type CreatedUser,
  type DeletedUser,
  type RoleChange,
} from "@/platform/iam/services/user-admin-service";
import { setUserActive } from "@/platform/iam/services/user-service";
import { logger, newCorrelationId } from "@/platform/observability/logger";

/**
 * User administration Server Actions (CLAUDE.md §9, ADR-019).
 *
 * They translate, they do not decide: every argument is untrusted and goes
 * straight to an IAM service, which authenticates the caller's permissions,
 * validates and audits. Hiding a button in the browser is never the control. A
 * raw exception never reaches the browser — only a safe message, and a reference
 * to the server log for anything unexpected.
 */

export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

async function run<T>(
  operation: string,
  work: (actor: Actor) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const actor = await getActor();
    const data = await work(actor);
    // The users list and the details pages beneath it — nothing wider.
    revalidatePath("/admin/users", "layout");
    return { ok: true, data };
  } catch (error) {
    if (isAppError(error)) {
      return {
        ok: false,
        message: error.message,
        ...(error instanceof ValidationError && Object.keys(error.fieldErrors).length > 0
          ? { fieldErrors: error.fieldErrors }
          : {}),
      };
    }
    const traceId = newCorrelationId();
    logger.error("User administration action failed", {
      module: "iam",
      operation,
      traceId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      message: `Something went wrong. Check the user before trying again. Reference: ${traceId}`,
    };
  }
}

export async function createUserAction(
  input: unknown,
): Promise<ActionResult<CreatedUser>> {
  return run("iam.user.create", (actor) => createUser(actor, input));
}

export async function updateUserAction(
  userId: string,
  input: unknown,
): Promise<ActionResult> {
  return run("iam.user.update", async (actor) => {
    await updateUser(actor, userId, input);
    return null;
  });
}

export async function setUserRolesAction(
  userId: string,
  input: unknown,
): Promise<ActionResult<RoleChange>> {
  return run("iam.user.roles", (actor) => setUserRoles(actor, userId, input));
}

export async function setUserStatusAction(
  userId: string,
  isActive: boolean,
  reason?: string,
): Promise<ActionResult> {
  return run("iam.user.status", async (actor) => {
    const given = typeof reason === "string" ? reason.trim() : "";
    await setUserActive(actor, {
      userId,
      isActive,
      reason:
        given.length >= 3
          ? given
          : isActive
            ? "Reactivated by an administrator"
            : "Deactivated by an administrator",
    });
    return null;
  });
}

export async function requestPasswordResetAction(
  userId: string,
): Promise<ActionResult<{ email: string }>> {
  return run("iam.user.passwordReset", (actor) => requestPasswordReset(actor, userId));
}

export async function setUserPasswordAction(
  userId: string,
  input: unknown,
): Promise<ActionResult<{ email: string }>> {
  return run("iam.user.passwordSet", (actor) => setUserPassword(actor, userId, input));
}

export async function deleteUserAction(
  userId: string,
  input: unknown,
): Promise<ActionResult<DeletedUser>> {
  return run("iam.user.delete", (actor) => deleteUser(actor, userId, input));
}
