"use server";

import { isAppError } from "@/lib/errors";
import { getActor } from "@/platform/auth/current-user";
import { can, type Actor } from "@/platform/authz/authz";
import { listDirectory } from "@/platform/iam/services/directory-service";
import { logger, newCorrelationId } from "@/platform/observability/logger";
import { CRM_PERMISSIONS } from "../contracts/permissions";
import { listAccountOptions, listContactOptions } from "../contracts/service";

/**
 * Option lists for the CRM dialogs, loaded when a dialog first opens instead of
 * with every page: they run to hundreds of rows that most visits never use.
 *
 * Read-only. Each list comes from its permission-checked service, and a list the
 * user may not read comes back empty — exactly what the pages passed before.
 */

type Option = { id: string; name: string };
type ContactOption = Option & { accountId: string | null };

export type OptionsResult<T> = { ok: true; data: T } | { ok: false; message: string };

async function load<T>(
  operation: string,
  work: (actor: Actor) => Promise<T>,
): Promise<OptionsResult<T>> {
  try {
    const actor = await getActor();
    return { ok: true, data: await work(actor) };
  } catch (error) {
    if (isAppError(error)) return { ok: false, message: error.message };
    const traceId = newCorrelationId();
    logger.error("CRM option list failed to load", {
      module: "crm",
      operation,
      traceId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      message: `The form could not be loaded. Close it and try again. Reference: ${traceId}`,
    };
  }
}

async function owners(actor: Actor): Promise<Option[]> {
  const people = await listDirectory(actor);
  return people.map((person) => ({ id: person.id, name: person.name }));
}

async function accountsIfPermitted(actor: Actor): Promise<Option[]> {
  return (await can(actor, CRM_PERMISSIONS.ACCOUNT_READ))
    ? listAccountOptions(actor)
    : [];
}

async function contactsIfPermitted(actor: Actor): Promise<ContactOption[]> {
  return (await can(actor, CRM_PERMISSIONS.CONTACT_READ))
    ? listContactOptions(actor)
    : [];
}

/** Owners, for the lead, company and activity dialogs. */
export async function loadOwnerOptionsAction(): Promise<
  OptionsResult<{ owners: Option[] }>
> {
  return load("crm.options.owners", async (actor) => ({ owners: await owners(actor) }));
}

/** Owners and companies, for the contact dialog. */
export async function loadContactFormOptionsAction(): Promise<
  OptionsResult<{ owners: Option[]; accounts: Option[] }>
> {
  return load("crm.options.contactForm", async (actor) => {
    const [ownerList, accounts] = await Promise.all([
      owners(actor),
      accountsIfPermitted(actor),
    ]);
    return { owners: ownerList, accounts };
  });
}

/** Owners, companies and contacts, for the edit-opportunity dialog. */
export async function loadOpportunityFormOptionsAction(): Promise<
  OptionsResult<{ owners: Option[]; accounts: Option[]; contacts: ContactOption[] }>
> {
  return load("crm.options.opportunityForm", async (actor) => {
    const [ownerList, accounts, contacts] = await Promise.all([
      owners(actor),
      accountsIfPermitted(actor),
      contactsIfPermitted(actor),
    ]);
    return { owners: ownerList, accounts, contacts };
  });
}
