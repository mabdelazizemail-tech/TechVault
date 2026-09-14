import type { Prisma } from "@prisma/client";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { diffForAudit, recordAudit } from "@/platform/audit/audit";
import { type Actor, can, canAll, requirePermission } from "@/platform/authz/authz";
import { publish } from "@/platform/events/publish";
import { CRM_EVENTS } from "../contracts/events";
import { CRM_PERMISSIONS } from "../contracts/permissions";
import { accountSchema, contactSchema, listParamsSchema } from "../contracts/schemas";
import type {
  AccountDetail,
  AccountListItem,
  ContactDetail,
  ContactListItem,
  MoneyTotal,
  Paginated,
} from "../contracts/types";
import { totalsFromGroups } from "../domain/pipeline";
import {
  accountListSelect,
  contactListSelect,
  leadListSelect,
  opportunityListSelect,
  personName,
  toAccountListItem,
  toContactListItem,
  toLeadListItem,
  toOpportunityListItem,
  toScopeTarget,
  userRefSelect,
} from "../repositories/selects";
import {
  CRM_MODULE,
  assertCanRead,
  auditFields,
  equalsInsensitive,
  insensitive,
  isUniqueViolation,
  isUuid,
  ownerScope,
  parseInput,
  searchTerms,
} from "./support";

/**
 * Companies (accounts) and contacts.
 *
 * The account is the platform's authoritative customer record (§6.1). Names are
 * unique among live companies and emails unique among live contacts, so a second
 * "Acme Corporation" is refused rather than silently created.
 */

/* ========================================================================== */
/* Accounts                                                                   */
/* ========================================================================== */

export async function listAccounts(
  actor: Actor,
  rawParams: Record<string, unknown> = {},
): Promise<Paginated<AccountListItem>> {
  await requirePermission(actor, CRM_PERMISSIONS.ACCOUNT_READ);
  const params = listParamsSchema.parse(rawParams);
  const scoped = await ownerScope(actor, CRM_PERMISSIONS.ACCOUNT_READ);

  const where: Prisma.CrmAccountWhereInput = {
    AND: [
      { deletedAt: null },
      scoped as Prisma.CrmAccountWhereInput,
      ...searchTerms(params.q).map((term) => ({
        OR: [
          { name: insensitive(term) },
          { industry: insensitive(term) },
          { city: insensitive(term) },
          { country: insensitive(term) },
        ],
      })),
    ],
  };

  const orderBy: Prisma.CrmAccountOrderByWithRelationInput[] =
    params.sort === "industry"
      ? [{ industry: params.dir }, { name: "asc" }]
      : params.sort === "createdAt"
        ? [{ createdAt: params.dir }]
        : [{ name: params.sort === "name" ? params.dir : "asc" }];

  const [total, rows] = await Promise.all([
    prisma.crmAccount.count({ where }),
    prisma.crmAccount.findMany({
      where,
      orderBy,
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
      select: accountListSelect,
    }),
  ]);

  const pipeline = await pipelineByAccount(rows.map((row) => row.id));

  return {
    rows: rows.map((row) => toAccountListItem(row, pipeline.get(row.id) ?? [])),
    total,
    page: params.page,
    pageSize: params.pageSize,
  };
}

/** Open pipeline per company, per currency — never one mixed figure. */
async function pipelineByAccount(
  accountIds: string[],
): Promise<Map<string, MoneyTotal[]>> {
  if (accountIds.length === 0) return new Map();
  const sums = await prisma.crmOpportunity.groupBy({
    by: ["accountId", "currency"],
    where: { accountId: { in: accountIds }, status: "OPEN", deletedAt: null },
    _sum: { amountMinor: true },
  });
  const grouped = new Map<string, typeof sums>();
  for (const sum of sums) {
    const rows = grouped.get(sum.accountId) ?? [];
    rows.push(sum);
    grouped.set(sum.accountId, rows);
  }
  return new Map(
    [...grouped].map(([accountId, rows]) => [accountId, totalsFromGroups(rows)]),
  );
}

export async function getAccount(
  actor: Actor,
  accountId: string,
): Promise<AccountDetail> {
  if (!isUuid(accountId)) throw new NotFoundError("company");
  const row = await prisma.crmAccount.findFirst({
    where: { id: accountId, deletedAt: null },
    select: {
      ...accountListSelect,
      website: true,
      companySize: true,
      phone: true,
      description: true,
      updatedAt: true,
    },
  });
  if (row === null) throw new NotFoundError("company");
  await assertCanRead(
    actor,
    CRM_PERMISSIONS.ACCOUNT_READ,
    toScopeTarget(row.ownerId, row.owner),
    "company",
  );

  const rights = await canAll(actor, [
    CRM_PERMISSIONS.CONTACT_READ,
    CRM_PERMISSIONS.OPPORTUNITY_READ,
    CRM_PERMISSIONS.LEAD_READ,
    CRM_PERMISSIONS.ACTIVITY_READ,
  ]);

  const [contacts, opportunities, leads, activityCount, pipeline] = await Promise.all([
    rights[CRM_PERMISSIONS.CONTACT_READ] === true
      ? ownerScope(actor, CRM_PERMISSIONS.CONTACT_READ).then((scoped) =>
          prisma.crmContact.findMany({
            where: {
              AND: [
                { accountId, deletedAt: null },
                scoped as Prisma.CrmContactWhereInput,
              ],
            },
            orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
            take: 50,
            select: contactListSelect,
          }),
        )
      : Promise.resolve([]),
    rights[CRM_PERMISSIONS.OPPORTUNITY_READ] === true
      ? ownerScope(actor, CRM_PERMISSIONS.OPPORTUNITY_READ).then((scoped) =>
          prisma.crmOpportunity.findMany({
            where: {
              AND: [
                { accountId, deletedAt: null },
                scoped as Prisma.CrmOpportunityWhereInput,
              ],
            },
            orderBy: [{ status: "asc" }, { closeDate: "asc" }],
            take: 50,
            select: opportunityListSelect,
          }),
        )
      : Promise.resolve([]),
    rights[CRM_PERMISSIONS.LEAD_READ] === true
      ? ownerScope(actor, CRM_PERMISSIONS.LEAD_READ).then((scoped) =>
          prisma.crmLead.findMany({
            where: {
              AND: [
                { deletedAt: null },
                {
                  OR: [
                    { convertedAccountId: accountId },
                    { company: equalsInsensitive(row.name) },
                  ],
                },
                scoped as Prisma.CrmLeadWhereInput,
              ],
            },
            orderBy: { createdAt: "desc" },
            take: 20,
            select: leadListSelect,
          }),
        )
      : Promise.resolve([]),
    rights[CRM_PERMISSIONS.ACTIVITY_READ] === true
      ? prisma.crmActivity.count({ where: { accountId, deletedAt: null } })
      : Promise.resolve(0),
    pipelineByAccount([accountId]),
  ]);

  return {
    ...toAccountListItem(row, pipeline.get(accountId) ?? []),
    website: row.website,
    companySize: row.companySize,
    phone: row.phone,
    description: row.description,
    activityCount,
    contacts: contacts.map(toContactListItem),
    opportunities: opportunities.map(toOpportunityListItem),
    leads: leads.map(toLeadListItem),
    updatedAt: row.updatedAt,
  };
}

export async function createAccount(
  actor: Actor,
  rawInput: unknown,
): Promise<{ id: string }> {
  await requirePermission(actor, CRM_PERMISSIONS.ACCOUNT_CREATE);
  const input = parseInput(accountSchema, rawInput);
  await assertAccountNameFree(input.name, null);

  try {
    return await prisma.$transaction(async (tx) => {
      const account = await tx.crmAccount.create({
        data: {
          ...input,
          ownerId: input.ownerId ?? actor.id,
          createdBy: actor.id,
          updatedBy: actor.id,
        },
        select: { id: true, name: true },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "crm.account.created",
          module: CRM_MODULE,
          entityType: "CrmAccount",
          entityId: account.id,
          summary: `Created company ${account.name}`,
        },
        tx,
      );
      await publish(tx, {
        name: CRM_EVENTS.CUSTOMER_CREATED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: { accountId: account.id },
      });
      return { id: account.id };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateAccount(input.name);
    throw error;
  }
}

export async function updateAccount(
  actor: Actor,
  accountId: string,
  rawInput: unknown,
): Promise<void> {
  if (!isUuid(accountId)) throw new NotFoundError("company");
  const existing = await prisma.crmAccount.findFirst({
    where: { id: accountId, deletedAt: null },
    select: {
      name: true,
      website: true,
      industry: true,
      companySize: true,
      country: true,
      city: true,
      phone: true,
      description: true,
      ownerId: true,
      owner: { select: userRefSelect },
    },
  });
  if (existing === null) throw new NotFoundError("company");
  const target = toScopeTarget(existing.ownerId, existing.owner);
  await assertCanRead(actor, CRM_PERMISSIONS.ACCOUNT_READ, target, "company");
  await requirePermission(actor, CRM_PERMISSIONS.ACCOUNT_UPDATE, target);

  const input = parseInput(accountSchema, rawInput);
  await assertAccountNameFree(input.name, accountId);
  const data = { ...input, ownerId: input.ownerId ?? existing.ownerId };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.crmAccount.update({
        where: { id: accountId },
        data: { ...data, updatedBy: actor.id },
      });
      const { owner: _owner, ...before } = existing;
      await recordAudit(
        {
          ...auditFields(actor),
          action: "crm.account.updated",
          module: CRM_MODULE,
          entityType: "CrmAccount",
          entityId: accountId,
          summary: `Updated company ${input.name}`,
          changes: diffForAudit(before, data),
        },
        tx,
      );
      await publish(tx, {
        name: CRM_EVENTS.CUSTOMER_UPDATED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: { accountId },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateAccount(input.name);
    throw error;
  }
}

/** Compact company choices for selects. */
export async function listAccountOptions(
  actor: Actor,
  query?: string,
): Promise<{ id: string; name: string }[]> {
  await requirePermission(actor, CRM_PERMISSIONS.ACCOUNT_READ);
  const scoped = await ownerScope(actor, CRM_PERMISSIONS.ACCOUNT_READ);
  return prisma.crmAccount.findMany({
    where: {
      AND: [
        { deletedAt: null },
        scoped as Prisma.CrmAccountWhereInput,
        query !== undefined && query !== "" ? { name: insensitive(query) } : {},
      ],
    },
    orderBy: { name: "asc" },
    take: 200,
    select: { id: true, name: true },
  });
}

async function assertAccountNameFree(
  name: string,
  exceptId: string | null,
): Promise<void> {
  const clash = await prisma.crmAccount.findFirst({
    where: {
      deletedAt: null,
      name: equalsInsensitive(name),
      ...(exceptId !== null ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (clash !== null) throw duplicateAccount(name);
}

function duplicateAccount(name: string): ConflictError {
  return new ConflictError(`A company named "${name}" already exists.`);
}

/* ========================================================================== */
/* Contacts                                                                   */
/* ========================================================================== */

export async function listContacts(
  actor: Actor,
  rawParams: Record<string, unknown> = {},
): Promise<Paginated<ContactListItem>> {
  await requirePermission(actor, CRM_PERMISSIONS.CONTACT_READ);
  const params = listParamsSchema.parse(rawParams);
  const scoped = await ownerScope(actor, CRM_PERMISSIONS.CONTACT_READ);

  const where: Prisma.CrmContactWhereInput = {
    AND: [
      { deletedAt: null },
      scoped as Prisma.CrmContactWhereInput,
      ...searchTerms(params.q).map((term) => ({
        OR: [
          { firstName: insensitive(term) },
          { lastName: insensitive(term) },
          { email: insensitive(term) },
          { jobTitle: insensitive(term) },
          { account: { name: insensitive(term) } },
        ],
      })),
    ],
  };

  const orderBy: Prisma.CrmContactOrderByWithRelationInput[] =
    params.sort === "company"
      ? [{ account: { name: params.dir } }, { lastName: "asc" }]
      : params.sort === "createdAt"
        ? [{ createdAt: params.dir }]
        : [
            { lastName: params.sort === "name" ? params.dir : "asc" },
            { firstName: "asc" },
          ];

  const [total, rows] = await Promise.all([
    prisma.crmContact.count({ where }),
    prisma.crmContact.findMany({
      where,
      orderBy,
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
      select: contactListSelect,
    }),
  ]);

  return {
    rows: rows.map(toContactListItem),
    total,
    page: params.page,
    pageSize: params.pageSize,
  };
}

export async function getContact(
  actor: Actor,
  contactId: string,
): Promise<ContactDetail> {
  if (!isUuid(contactId)) throw new NotFoundError("contact");
  const row = await prisma.crmContact.findFirst({
    where: { id: contactId, deletedAt: null },
    select: { ...contactListSelect, country: true, city: true, updatedAt: true },
  });
  if (row === null) throw new NotFoundError("contact");
  await assertCanRead(
    actor,
    CRM_PERMISSIONS.CONTACT_READ,
    toScopeTarget(row.ownerId, row.owner),
    "contact",
  );

  const opportunities = (await can(actor, CRM_PERMISSIONS.OPPORTUNITY_READ))
    ? await ownerScope(actor, CRM_PERMISSIONS.OPPORTUNITY_READ).then((scoped) =>
        prisma.crmOpportunity.findMany({
          where: {
            AND: [
              { deletedAt: null, contacts: { some: { contactId } } },
              scoped as Prisma.CrmOpportunityWhereInput,
            ],
          },
          orderBy: [{ status: "asc" }, { closeDate: "asc" }],
          take: 50,
          select: opportunityListSelect,
        }),
      )
    : [];

  return {
    ...toContactListItem(row),
    firstName: row.firstName,
    lastName: row.lastName,
    country: row.country,
    city: row.city,
    opportunities: opportunities.map(toOpportunityListItem),
    updatedAt: row.updatedAt,
  };
}

export async function createContact(
  actor: Actor,
  rawInput: unknown,
): Promise<{ id: string }> {
  await requirePermission(actor, CRM_PERMISSIONS.CONTACT_CREATE);
  const input = parseInput(contactSchema, rawInput);
  await assertContactEmailFree(input.email, null);
  await assertAccountReadable(actor, input.accountId);

  try {
    return await prisma.$transaction(async (tx) => {
      const contact = await tx.crmContact.create({
        data: {
          ...input,
          ownerId: input.ownerId ?? actor.id,
          createdBy: actor.id,
          updatedBy: actor.id,
        },
        select: { id: true, firstName: true, lastName: true, accountId: true },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "crm.contact.created",
          module: CRM_MODULE,
          entityType: "CrmContact",
          entityId: contact.id,
          summary: `Created contact ${personName(contact)}`,
        },
        tx,
      );
      await publish(tx, {
        name: CRM_EVENTS.CONTACT_CREATED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: { contactId: contact.id, accountId: contact.accountId },
      });
      return { id: contact.id };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateContact(input.email);
    throw error;
  }
}

export async function updateContact(
  actor: Actor,
  contactId: string,
  rawInput: unknown,
): Promise<void> {
  if (!isUuid(contactId)) throw new NotFoundError("contact");
  const existing = await prisma.crmContact.findFirst({
    where: { id: contactId, deletedAt: null },
    select: {
      firstName: true,
      lastName: true,
      jobTitle: true,
      email: true,
      phone: true,
      country: true,
      city: true,
      accountId: true,
      ownerId: true,
      owner: { select: userRefSelect },
    },
  });
  if (existing === null) throw new NotFoundError("contact");
  const target = toScopeTarget(existing.ownerId, existing.owner);
  await assertCanRead(actor, CRM_PERMISSIONS.CONTACT_READ, target, "contact");
  await requirePermission(actor, CRM_PERMISSIONS.CONTACT_UPDATE, target);

  const input = parseInput(contactSchema, rawInput);
  await assertContactEmailFree(input.email, contactId);
  await assertAccountReadable(actor, input.accountId);
  const data = { ...input, ownerId: input.ownerId ?? existing.ownerId };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.crmContact.update({
        where: { id: contactId },
        data: { ...data, updatedBy: actor.id },
      });
      const { owner: _owner, ...before } = existing;
      await recordAudit(
        {
          ...auditFields(actor),
          action: "crm.contact.updated",
          module: CRM_MODULE,
          entityType: "CrmContact",
          entityId: contactId,
          summary: `Updated contact ${input.firstName} ${input.lastName}`,
          changes: diffForAudit(before, data),
        },
        tx,
      );
      await publish(tx, {
        name: CRM_EVENTS.CONTACT_UPDATED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: { contactId },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateContact(input.email);
    throw error;
  }
}

export async function listContactOptions(
  actor: Actor,
  accountId?: string | null,
): Promise<{ id: string; name: string; accountId: string | null }[]> {
  await requirePermission(actor, CRM_PERMISSIONS.CONTACT_READ);
  const scoped = await ownerScope(actor, CRM_PERMISSIONS.CONTACT_READ);
  const rows = await prisma.crmContact.findMany({
    where: {
      AND: [
        { deletedAt: null },
        scoped as Prisma.CrmContactWhereInput,
        accountId !== undefined && accountId !== null ? { accountId } : {},
      ],
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 300,
    select: { id: true, firstName: true, lastName: true, accountId: true },
  });
  return rows.map((row) => ({
    id: row.id,
    name: personName(row),
    accountId: row.accountId,
  }));
}

async function assertContactEmailFree(
  email: string | null,
  exceptId: string | null,
): Promise<void> {
  if (email === null) return;
  const clash = await prisma.crmContact.findFirst({
    where: {
      deletedAt: null,
      email: equalsInsensitive(email),
      ...(exceptId !== null ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (clash !== null) throw duplicateContact(email);
}

async function assertAccountReadable(
  actor: Actor,
  accountId: string | null,
): Promise<void> {
  if (accountId === null) return;
  const account = await prisma.crmAccount.findFirst({
    where: { id: accountId, deletedAt: null },
    select: { ownerId: true, owner: { select: userRefSelect } },
  });
  if (account === null) throw new NotFoundError("company");
  await assertCanRead(
    actor,
    CRM_PERMISSIONS.ACCOUNT_READ,
    toScopeTarget(account.ownerId, account.owner),
    "company",
  );
}

function duplicateContact(email: string | null): ConflictError {
  return new ConflictError(
    email === null
      ? "A contact with these details already exists."
      : `A contact with the email ${email} already exists.`,
  );
}
