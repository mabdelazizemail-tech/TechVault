"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAppError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/platform/authz/authz";
import { getActor } from "@/platform/auth/current-user";
import { logger, newCorrelationId } from "@/platform/observability/logger";
import * as crm from "../contracts/service";
import {
  LEAD_STATUSES,
  type ActivityDto,
  type ConversionResult,
  type DeletionImpact,
  type LeadStatus,
  type OpportunityListItem,
} from "../contracts/types";
import { recordListHref } from "./links";

/**
 * CRM Server Actions — the entry points every CRM screen calls (CLAUDE.md §9).
 *
 * They translate, they do not decide: authenticate, delegate to the CRM service
 * (which authorises and validates), and turn the outcome into a result a form can
 * render. A raw exception never reaches the browser — only a safe message and, for
 * unexpected failures, a reference that ties to the server log (§16.6, §19.3).
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
    // Every CRM screen shows derived figures (counts, totals, timelines), so a
    // change anywhere refreshes the CRM section rather than guessing which pages.
    revalidatePath("/crm", "layout");
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
    logger.error("CRM action failed", {
      module: "crm",
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

/* Leads ------------------------------------------------------------------- */

export async function createLeadAction(
  input: unknown,
): Promise<ActionResult<crm.CreateLeadResult>> {
  return run("crm.lead.create", (actor) => crm.createLead(actor, input));
}

export async function updateLeadAction(
  leadId: string,
  input: unknown,
): Promise<ActionResult> {
  return run("crm.lead.update", async (actor) => {
    await crm.updateLead(actor, leadId, input);
    return null;
  });
}

export async function setLeadStatusAction(input: unknown): Promise<ActionResult> {
  return run("crm.lead.status", async (actor) => {
    await crm.setLeadStatus(actor, input);
    return null;
  });
}

export async function convertLeadAction(
  input: unknown,
): Promise<ActionResult<ConversionResult>> {
  return run("crm.lead.convert", (actor) => crm.convertLead(actor, input));
}

export async function bulkUpdateLeadsAction(input: {
  leadIds: string[];
  status?: string;
  ownerId?: string;
}): Promise<ActionResult<{ updated: number; skipped: number }>> {
  return run("crm.lead.bulk", (actor) => {
    const status =
      input.status !== undefined &&
      (LEAD_STATUSES as readonly string[]).includes(input.status)
        ? (input.status as LeadStatus)
        : undefined;
    return crm.bulkUpdateLeads(actor, {
      leadIds: input.leadIds,
      status,
      ownerId: input.ownerId === "" ? undefined : input.ownerId,
    });
  });
}

/* Companies and contacts --------------------------------------------------- */

export async function createAccountAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return run("crm.account.create", (actor) => crm.createAccount(actor, input));
}

export async function updateAccountAction(
  accountId: string,
  input: unknown,
): Promise<ActionResult> {
  return run("crm.account.update", async (actor) => {
    await crm.updateAccount(actor, accountId, input);
    return null;
  });
}

export async function createContactAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return run("crm.contact.create", (actor) => crm.createContact(actor, input));
}

export async function updateContactAction(
  contactId: string,
  input: unknown,
): Promise<ActionResult> {
  return run("crm.contact.update", async (actor) => {
    await crm.updateContact(actor, contactId, input);
    return null;
  });
}

/* Opportunities ------------------------------------------------------------ */

export async function createOpportunityAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return run("crm.opportunity.create", (actor) => crm.createOpportunity(actor, input));
}

export async function updateOpportunityAction(
  opportunityId: string,
  input: unknown,
): Promise<ActionResult> {
  return run("crm.opportunity.update", async (actor) => {
    await crm.updateOpportunity(actor, opportunityId, input);
    return null;
  });
}

/** The drag-and-drop move. Also used by the stage tracker on the detail page. */
export async function moveOpportunityAction(
  input: unknown,
): Promise<ActionResult<OpportunityListItem>> {
  return run("crm.opportunity.move", (actor) => crm.moveOpportunity(actor, input));
}

/* Activities --------------------------------------------------------------- */

export async function logActivityAction(
  input: unknown,
): Promise<ActionResult<ActivityDto>> {
  return run("crm.activity.log", (actor) => crm.logActivity(actor, input));
}

export async function updateActivityAction(
  activityId: string,
  input: unknown,
): Promise<ActionResult<ActivityDto>> {
  return run("crm.activity.update", (actor) =>
    crm.updateActivity(actor, activityId, input),
  );
}

export async function setTaskCompletedAction(
  activityId: string,
  completed: boolean,
): Promise<ActionResult> {
  return run("crm.task.complete", async (actor) => {
    await crm.setTaskCompleted(actor, { activityId, completed });
    return null;
  });
}

/* Deletion — administrators only; the services decide who may -------------- */

export async function getDeletionImpactAction(
  target: unknown,
): Promise<ActionResult<DeletionImpact>> {
  return run("crm.deletion.preview", (actor) => crm.getDeletionImpact(actor, target));
}

/*
 * Deleting a lead, company, contact or opportunity ends on that record type's list.
 * `redirect` throws to navigate, so it runs after `run`, outside its try block.
 */

export async function deleteLeadAction(leadId: string): Promise<ActionResult> {
  const result = await run("crm.lead.delete", async (actor) => {
    await crm.deleteLead(actor, leadId);
    return null;
  });
  if (result.ok) redirect(recordListHref("lead"));
  return result;
}

export async function deleteAccountAction(accountId: string): Promise<ActionResult> {
  const result = await run("crm.account.delete", async (actor) => {
    await crm.deleteAccount(actor, accountId);
    return null;
  });
  if (result.ok) redirect(recordListHref("account"));
  return result;
}

export async function deleteContactAction(contactId: string): Promise<ActionResult> {
  const result = await run("crm.contact.delete", async (actor) => {
    await crm.deleteContact(actor, contactId);
    return null;
  });
  if (result.ok) redirect(recordListHref("contact"));
  return result;
}

export async function deleteOpportunityAction(
  opportunityId: string,
): Promise<ActionResult> {
  const result = await run("crm.opportunity.delete", async (actor) => {
    await crm.deleteOpportunity(actor, opportunityId);
    return null;
  });
  if (result.ok) redirect(recordListHref("opportunity"));
  return result;
}

export async function deleteActivityAction(activityId: string): Promise<ActionResult> {
  return run("crm.activity.delete", async (actor) => {
    await crm.deleteActivity(actor, activityId);
    return null;
  });
}
