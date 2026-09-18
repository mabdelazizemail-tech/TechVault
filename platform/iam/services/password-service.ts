import { z } from "zod";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/platform/audit/audit";
import { changePasswordWithCurrent } from "@/platform/auth/identity-admin";
import type { Actor } from "@/platform/authz/authz";

/**
 * Changing one's own password (ADR-034).
 *
 * The proof is the current password, checked by Supabase Auth, not a permission:
 * every active account may change its own password, and an account holding a
 * temporary password set by an administrator may do nothing else. A password is
 * never stored, logged or audited — only the fact that it changed.
 */

/** The same rule wherever a password is chosen: Supabase's bcrypt reads 72 bytes. */
export const newPasswordField = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(72, "Use at most 72 characters.");

export const changeOwnPasswordInput = z
  .object({
    currentPassword: z
      .string()
      .min(1, "Enter your current password.")
      .max(72, "Use at most 72 characters."),
    newPassword: newPasswordField,
    confirmPassword: z.string(),
  })
  .refine((input) => input.newPassword === input.confirmPassword, {
    path: ["confirmPassword"],
    message: "The two passwords do not match.",
  })
  .refine((input) => input.newPassword !== input.currentPassword, {
    path: ["newPassword"],
    message: "Choose a password different from your current one.",
  });

function parse(input: unknown) {
  const parsed = changeOwnPasswordInput.safeParse(input);
  if (!parsed.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.map(String).join(".") || "_";
      (fields[key] ??= []).push(issue.message);
    }
    throw new ValidationError("Please correct the highlighted fields.", fields);
  }
  return parsed.data;
}

/**
 * Changes the caller's password and ends every session of the account, then lifts
 * the temporary-password hold. The browser must sign in again afterwards.
 */
export async function changeOwnPassword(
  actor: Actor & { email: string },
  rawInput: unknown,
): Promise<void> {
  const input = parse(rawInput);

  const user = await prisma.user.findFirst({
    where: { id: actor.id, deletedAt: null, isActive: true },
    select: { id: true, mustChangePassword: true },
  });
  if (user === null) throw new NotFoundError("user");

  // Supabase first: if it refuses (wrong current password, weak new one) nothing
  // here changes. If the database write below then fails, the hold simply stays
  // and the holder is asked once more — the safe direction.
  await changePasswordWithCurrent(actor.email, input.currentPassword, input.newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { mustChangePassword: false, updatedBy: actor.id },
    });
    await recordAudit(
      {
        actorId: actor.id,
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        correlationId: actor.correlationId ?? null,
        action: "iam.user.password_changed",
        module: "iam",
        entityType: "User",
        entityId: user.id,
        summary: user.mustChangePassword
          ? "Replaced a temporary password with their own"
          : "Changed their own password",
        changes: { replacedTemporaryPassword: user.mustChangePassword },
        severity: "NOTICE",
      },
      tx,
    );
  });
}
