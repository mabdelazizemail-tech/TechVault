"use server";

import { revalidatePath } from "next/cache";
import { isAppError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/platform/authz/authz";
import { getActor } from "@/platform/auth/current-user";
import { logger, newCorrelationId } from "@/platform/observability/logger";
import * as erp from "../contracts/service";

/**
 * ERP finance Server Actions (CLAUDE.md §9): authenticate, delegate to the service —
 * which authorises, validates and enforces every accounting rule — and turn the
 * outcome into something a form can show. No business rule lives here.
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
    // Balances, counts and statuses appear across the finance screens.
    revalidatePath("/erp", "layout");
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
    logger.error("ERP action failed", {
      module: "erp",
      operation,
      traceId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      message: `Something went wrong and nothing was saved. Reference: ${traceId}`,
    };
  }
}

/* Accounts ------------------------------------------------------------------ */

export async function createAccountAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return run("erp.account.create", (actor) => erp.createAccount(actor, input));
}

export async function updateAccountAction(
  accountId: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return run("erp.account.update", (actor) => erp.updateAccount(actor, accountId, input));
}

export async function setAccountActiveAction(
  accountId: string,
  isActive: boolean,
): Promise<ActionResult<{ id: string }>> {
  return run("erp.account.administer", (actor) =>
    erp.setAccountActive(actor, accountId, { isActive }),
  );
}

/* Cost centres -------------------------------------------------------------- */

export async function createCostCentreAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return run("erp.cost_centre.create", (actor) => erp.createCostCentre(actor, input));
}

export async function updateCostCentreAction(
  costCentreId: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return run("erp.cost_centre.update", (actor) =>
    erp.updateCostCentre(actor, costCentreId, input),
  );
}

/* Periods ------------------------------------------------------------------- */

export async function createPeriodAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return run("erp.period.create", (actor) => erp.createPeriod(actor, input));
}

export async function closePeriodAction(periodId: string): Promise<ActionResult> {
  return run("erp.period.close", async (actor) => {
    await erp.closePeriod(actor, periodId);
    return null;
  });
}

export async function reopenPeriodAction(
  periodId: string,
  input: unknown,
): Promise<ActionResult> {
  return run("erp.period.reopen", async (actor) => {
    await erp.reopenPeriod(actor, periodId, input);
    return null;
  });
}

/* Journals ------------------------------------------------------------------ */

export async function createJournalAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return run("erp.journal.create", (actor) => erp.createJournal(actor, input));
}

export async function updateJournalAction(
  entryId: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return run("erp.journal.update", (actor) => erp.updateJournal(actor, entryId, input));
}

export async function deleteJournalAction(entryId: string): Promise<ActionResult> {
  return run("erp.journal.delete", async (actor) => {
    await erp.deleteJournal(actor, entryId);
    return null;
  });
}

export async function postJournalAction(
  entryId: string,
): Promise<ActionResult<{ journalNumber: string }>> {
  return run("erp.journal.post", (actor) => erp.postJournal(actor, entryId));
}

export async function reverseJournalAction(
  entryId: string,
  input: unknown,
): Promise<ActionResult<{ reversalId: string; journalNumber: string }>> {
  return run("erp.journal.reverse", (actor) => erp.reverseJournal(actor, entryId, input));
}

/* Finance settings ---------------------------------------------------------- */

export async function updateFinanceSettingsAction(input: unknown): Promise<ActionResult> {
  return run("erp.finance_settings.administer", async (actor) => {
    await erp.updateFinanceSettings(actor, input);
    return null;
  });
}
