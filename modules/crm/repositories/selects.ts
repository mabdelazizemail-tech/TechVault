import type { Prisma } from "@prisma/client";
import type { ScopeTarget } from "@/platform/authz/types";
import type {
  AccountListItem,
  ActivityDto,
  ContactListItem,
  LeadDetail,
  LeadListItem,
  MoneyTotal,
  OpportunityDetail,
  OpportunityListItem,
  RecordRef,
  StageDto,
  UserRef,
} from "../contracts/types";

/**
 * Query shapes and row → DTO mappers.
 *
 * Every CRM read goes through one of these selects, so a column that is not in a
 * DTO is never fetched — `select`, not `include`, is also a security control
 * (CLAUDE.md §21). No business logic and no permission checks live here.
 */

/* -------------------------------------------------------------------------- */
/* Shared                                                                     */
/* -------------------------------------------------------------------------- */

/** A user reference, carrying the org-unit path scope checks need. */
export const userRefSelect = {
  id: true,
  fullName: true,
  email: true,
  orgUnitId: true,
  orgUnit: { select: { path: true } },
} as const satisfies Prisma.UserSelect;

type UserRow = {
  id: string;
  fullName: string | null;
  email: string;
  orgUnitId: string | null;
  orgUnit: { path: string } | null;
};

export function toUserRef(user: UserRow | null): UserRef | null {
  return user === null ? null : { id: user.id, name: user.fullName ?? user.email };
}

/** The scope target for a record owned by `owner`. */
export function toScopeTarget(
  ownerId: string | null,
  owner: UserRow | null,
): ScopeTarget {
  return {
    ownerId,
    orgUnitId: owner?.orgUnitId ?? null,
    orgUnitPath: owner?.orgUnit?.path ?? null,
  };
}

export function personName(person: { firstName: string; lastName: string }): string {
  return `${person.firstName} ${person.lastName}`.trim();
}

/* -------------------------------------------------------------------------- */
/* Stages                                                                     */
/* -------------------------------------------------------------------------- */

export const stageSelect = {
  id: true,
  key: true,
  name: true,
  position: true,
  kind: true,
  defaultProbability: true,
} as const satisfies Prisma.CrmOpportunityStageSelect;

export function toStageDto(
  row: Prisma.CrmOpportunityStageGetPayload<{ select: typeof stageSelect }>,
): StageDto {
  return { ...row };
}

/* -------------------------------------------------------------------------- */
/* Leads                                                                      */
/* -------------------------------------------------------------------------- */

export const leadListSelect = {
  id: true,
  firstName: true,
  lastName: true,
  company: true,
  email: true,
  status: true,
  score: true,
  source: true,
  ownerId: true,
  createdAt: true,
  owner: { select: userRefSelect },
} as const satisfies Prisma.CrmLeadSelect;

export type LeadListRow = Prisma.CrmLeadGetPayload<{ select: typeof leadListSelect }>;

export function toLeadListItem(row: LeadListRow): LeadListItem {
  return {
    id: row.id,
    name: personName(row),
    company: row.company,
    email: row.email,
    status: row.status,
    score: row.score,
    source: row.source,
    owner: toUserRef(row.owner),
    createdAt: row.createdAt,
  };
}

export const leadDetailSelect = {
  ...leadListSelect,
  jobTitle: true,
  phone: true,
  website: true,
  industry: true,
  companySize: true,
  country: true,
  city: true,
  interest: true,
  budgetMinor: true,
  currency: true,
  timeline: true,
  decisionMaker: true,
  currentSolution: true,
  painPoint: true,
  statusChangedAt: true,
  convertedAt: true,
  updatedAt: true,
  convertedAccount: { select: { id: true, name: true } },
  convertedContact: { select: { id: true, firstName: true, lastName: true } },
  convertedOpportunity: { select: { id: true, name: true } },
} as const satisfies Prisma.CrmLeadSelect;

export type LeadDetailRow = Prisma.CrmLeadGetPayload<{ select: typeof leadDetailSelect }>;

export function toLeadDetail(row: LeadDetailRow): LeadDetail {
  return {
    ...toLeadListItem(row),
    firstName: row.firstName,
    lastName: row.lastName,
    jobTitle: row.jobTitle,
    phone: row.phone,
    website: row.website,
    industry: row.industry,
    companySize: row.companySize,
    country: row.country,
    city: row.city,
    interest: row.interest,
    budgetMinor: row.budgetMinor,
    currency: row.currency,
    timeline: row.timeline,
    decisionMaker: row.decisionMaker,
    currentSolution: row.currentSolution,
    painPoint: row.painPoint,
    statusChangedAt: row.statusChangedAt,
    convertedAt: row.convertedAt,
    convertedAccount:
      row.convertedAccount === null
        ? null
        : {
            kind: "account",
            id: row.convertedAccount.id,
            label: row.convertedAccount.name,
          },
    convertedContact:
      row.convertedContact === null
        ? null
        : {
            kind: "contact",
            id: row.convertedContact.id,
            label: personName(row.convertedContact),
          },
    convertedOpportunity:
      row.convertedOpportunity === null
        ? null
        : {
            kind: "opportunity",
            id: row.convertedOpportunity.id,
            label: row.convertedOpportunity.name,
          },
    updatedAt: row.updatedAt,
  };
}

/* -------------------------------------------------------------------------- */
/* Accounts                                                                   */
/* -------------------------------------------------------------------------- */

export const accountListSelect = {
  id: true,
  name: true,
  industry: true,
  city: true,
  country: true,
  ownerId: true,
  createdAt: true,
  owner: { select: userRefSelect },
  _count: {
    select: {
      contacts: { where: { deletedAt: null } },
      opportunities: { where: { deletedAt: null, status: "OPEN" } },
    },
  },
} as const satisfies Prisma.CrmAccountSelect;

export type AccountListRow = Prisma.CrmAccountGetPayload<{
  select: typeof accountListSelect;
}>;

export function toAccountListItem(
  row: AccountListRow,
  pipeline: MoneyTotal[],
): AccountListItem {
  return {
    id: row.id,
    name: row.name,
    industry: row.industry,
    city: row.city,
    country: row.country,
    owner: toUserRef(row.owner),
    contactCount: row._count.contacts,
    openOpportunityCount: row._count.opportunities,
    pipeline,
    createdAt: row.createdAt,
  };
}

/* -------------------------------------------------------------------------- */
/* Contacts                                                                   */
/* -------------------------------------------------------------------------- */

export const contactListSelect = {
  id: true,
  firstName: true,
  lastName: true,
  jobTitle: true,
  email: true,
  phone: true,
  ownerId: true,
  createdAt: true,
  account: { select: { id: true, name: true } },
  owner: { select: userRefSelect },
} as const satisfies Prisma.CrmContactSelect;

export type ContactListRow = Prisma.CrmContactGetPayload<{
  select: typeof contactListSelect;
}>;

export function toContactListItem(row: ContactListRow): ContactListItem {
  return {
    id: row.id,
    name: personName(row),
    jobTitle: row.jobTitle,
    email: row.email,
    phone: row.phone,
    account: row.account,
    owner: toUserRef(row.owner),
    createdAt: row.createdAt,
  };
}

/* -------------------------------------------------------------------------- */
/* Opportunities                                                              */
/* -------------------------------------------------------------------------- */

export const opportunityListSelect = {
  id: true,
  name: true,
  status: true,
  amountMinor: true,
  currency: true,
  closeDate: true,
  probability: true,
  priority: true,
  channel: true,
  partnerName: true,
  product: true,
  source: true,
  ownerId: true,
  stageId: true,
  account: { select: { id: true, name: true, industry: true } },
  stage: { select: { id: true, name: true, kind: true } },
  owner: { select: userRefSelect },
  contacts: {
    where: { isPrimary: true },
    take: 1,
    select: {
      contact: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          jobTitle: true,
          email: true,
          phone: true,
        },
      },
    },
  },
} as const satisfies Prisma.CrmOpportunitySelect;

export type OpportunityListRow = Prisma.CrmOpportunityGetPayload<{
  select: typeof opportunityListSelect;
}>;

export function toOpportunityListItem(row: OpportunityListRow): OpportunityListItem {
  const primary = row.contacts[0]?.contact ?? null;
  return {
    id: row.id,
    name: row.name,
    account: { id: row.account.id, name: row.account.name },
    primaryContact:
      primary === null ? null : { id: primary.id, name: personName(primary) },
    stage: row.stage,
    status: row.status,
    amountMinor: row.amountMinor,
    currency: row.currency,
    closeDate: row.closeDate,
    probability: row.probability,
    priority: row.priority,
    channel: row.channel,
    partnerName: row.partnerName,
    product: row.product,
    owner: toUserRef(row.owner),
    industry: row.account.industry,
    source: row.source,
  };
}

export const opportunityDetailSelect = {
  ...opportunityListSelect,
  description: true,
  wonAt: true,
  lostAt: true,
  lostReason: true,
  closeNotes: true,
  stageChangedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.CrmOpportunitySelect;

export type OpportunityDetailRow = Prisma.CrmOpportunityGetPayload<{
  select: typeof opportunityDetailSelect;
}>;

export function toOpportunityDetail(row: OpportunityDetailRow): OpportunityDetail {
  const primary = row.contacts[0]?.contact ?? null;
  return {
    ...toOpportunityListItem(row),
    description: row.description,
    wonAt: row.wonAt,
    lostAt: row.lostAt,
    lostReason: row.lostReason,
    closeNotes: row.closeNotes,
    stageChangedAt: row.stageChangedAt,
    primaryContactDetail:
      primary === null
        ? null
        : {
            id: primary.id,
            name: personName(primary),
            jobTitle: primary.jobTitle,
            email: primary.email,
            phone: primary.phone,
          },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/* -------------------------------------------------------------------------- */
/* Activities                                                                 */
/* -------------------------------------------------------------------------- */

export const activitySelect = {
  id: true,
  type: true,
  subject: true,
  body: true,
  occurredAt: true,
  durationMinutes: true,
  dueAt: true,
  completedAt: true,
  priority: true,
  metadata: true,
  createdBy: true,
  assigneeId: true,
  assignee: { select: userRefSelect },
  creator: { select: userRefSelect },
  lead: { select: { id: true, firstName: true, lastName: true } },
  account: { select: { id: true, name: true } },
  contact: { select: { id: true, firstName: true, lastName: true } },
  opportunity: { select: { id: true, name: true } },
} as const satisfies Prisma.CrmActivitySelect;

export type ActivityRow = Prisma.CrmActivityGetPayload<{ select: typeof activitySelect }>;

export function toActivityDto(row: ActivityRow): ActivityDto {
  const related: RecordRef[] = [];
  if (row.lead !== null) {
    related.push({ kind: "lead", id: row.lead.id, label: personName(row.lead) });
  }
  if (row.contact !== null) {
    related.push({ kind: "contact", id: row.contact.id, label: personName(row.contact) });
  }
  if (row.account !== null) {
    related.push({ kind: "account", id: row.account.id, label: row.account.name });
  }
  if (row.opportunity !== null) {
    related.push({
      kind: "opportunity",
      id: row.opportunity.id,
      label: row.opportunity.name,
    });
  }

  return {
    id: row.id,
    type: row.type,
    subject: row.subject,
    body: row.body,
    occurredAt: row.occurredAt,
    durationMinutes: row.durationMinutes,
    dueAt: row.dueAt,
    completedAt: row.completedAt,
    priority: row.priority,
    assignee: toUserRef(row.assignee),
    creator: toUserRef(row.creator),
    related,
    metadata:
      row.metadata !== null &&
      typeof row.metadata === "object" &&
      !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : null,
  };
}
