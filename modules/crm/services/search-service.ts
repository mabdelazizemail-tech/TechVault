import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { type Actor, canAll, requirePermission } from "@/platform/authz/authz";
import { CRM_PERMISSIONS } from "../contracts/permissions";
import type { SearchHit, SearchResults } from "../contracts/types";
import { personName } from "../repositories/selects";
import { insensitive, ownerScope, searchTerms } from "./support";

/**
 * Global CRM search across leads, companies, contacts and opportunities.
 *
 * Each entity is searched only if the actor may read it, and each query is
 * narrowed by the actor's scope BEFORE results are returned — search must never be
 * a way round the permission model (CLAUDE.md §7, platform/search rule).
 */

const HITS_PER_ENTITY = 8;
const MIN_QUERY_LENGTH = 2;

export async function searchCrm(actor: Actor, rawQuery: string): Promise<SearchResults> {
  await requirePermission(actor, CRM_PERMISSIONS.ACCESS);
  const query = rawQuery.trim().slice(0, 100);
  const terms = searchTerms(query);

  const empty: SearchResults = {
    query,
    leads: [],
    accounts: [],
    contacts: [],
    opportunities: [],
  };
  if (query.length < MIN_QUERY_LENGTH || terms.length === 0) return empty;

  const rights = await canAll(actor, [
    CRM_PERMISSIONS.LEAD_READ,
    CRM_PERMISSIONS.ACCOUNT_READ,
    CRM_PERMISSIONS.CONTACT_READ,
    CRM_PERMISSIONS.OPPORTUNITY_READ,
  ]);

  const [leads, accounts, contacts, opportunities] = await Promise.all([
    rights[CRM_PERMISSIONS.LEAD_READ] === true ? searchLeads(actor, terms) : [],
    rights[CRM_PERMISSIONS.ACCOUNT_READ] === true ? searchAccounts(actor, terms) : [],
    rights[CRM_PERMISSIONS.CONTACT_READ] === true ? searchContacts(actor, terms) : [],
    rights[CRM_PERMISSIONS.OPPORTUNITY_READ] === true
      ? searchOpportunities(actor, terms)
      : [],
  ]);

  return { query, leads, accounts, contacts, opportunities };
}

async function searchLeads(actor: Actor, terms: string[]): Promise<SearchHit[]> {
  const scoped = await ownerScope(actor, CRM_PERMISSIONS.LEAD_READ);
  const rows = await prisma.crmLead.findMany({
    where: {
      AND: [
        { deletedAt: null },
        scoped as Prisma.CrmLeadWhereInput,
        ...terms.map((term) => ({
          OR: [
            { firstName: insensitive(term) },
            { lastName: insensitive(term) },
            { company: insensitive(term) },
            { email: insensitive(term) },
          ],
        })),
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: HITS_PER_ENTITY,
    select: { id: true, firstName: true, lastName: true, company: true, status: true },
  });
  return rows.map((row) => ({
    kind: "lead",
    id: row.id,
    label: personName(row),
    detail: row.company,
  }));
}

async function searchAccounts(actor: Actor, terms: string[]): Promise<SearchHit[]> {
  const scoped = await ownerScope(actor, CRM_PERMISSIONS.ACCOUNT_READ);
  const rows = await prisma.crmAccount.findMany({
    where: {
      AND: [
        { deletedAt: null },
        scoped as Prisma.CrmAccountWhereInput,
        ...terms.map((term) => ({
          OR: [{ name: insensitive(term) }, { industry: insensitive(term) }],
        })),
      ],
    },
    orderBy: { name: "asc" },
    take: HITS_PER_ENTITY,
    select: { id: true, name: true, industry: true, city: true },
  });
  return rows.map((row) => ({
    kind: "account",
    id: row.id,
    label: row.name,
    detail: [row.industry, row.city].filter((part) => part !== null).join(" · ") || null,
  }));
}

async function searchContacts(actor: Actor, terms: string[]): Promise<SearchHit[]> {
  const scoped = await ownerScope(actor, CRM_PERMISSIONS.CONTACT_READ);
  const rows = await prisma.crmContact.findMany({
    where: {
      AND: [
        { deletedAt: null },
        scoped as Prisma.CrmContactWhereInput,
        ...terms.map((term) => ({
          OR: [
            { firstName: insensitive(term) },
            { lastName: insensitive(term) },
            { email: insensitive(term) },
            { account: { name: insensitive(term) } },
          ],
        })),
      ],
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: HITS_PER_ENTITY,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      jobTitle: true,
      account: { select: { name: true } },
    },
  });
  return rows.map((row) => ({
    kind: "contact",
    id: row.id,
    label: personName(row),
    detail:
      [row.jobTitle, row.account?.name ?? null]
        .filter((part) => part !== null)
        .join(" · ") || null,
  }));
}

async function searchOpportunities(actor: Actor, terms: string[]): Promise<SearchHit[]> {
  const scoped = await ownerScope(actor, CRM_PERMISSIONS.OPPORTUNITY_READ);
  const rows = await prisma.crmOpportunity.findMany({
    where: {
      AND: [
        { deletedAt: null },
        scoped as Prisma.CrmOpportunityWhereInput,
        ...terms.map((term) => ({
          OR: [{ name: insensitive(term) }, { account: { name: insensitive(term) } }],
        })),
      ],
    },
    orderBy: [{ status: "asc" }, { closeDate: "asc" }],
    take: HITS_PER_ENTITY,
    select: {
      id: true,
      name: true,
      account: { select: { name: true } },
      stage: { select: { name: true } },
    },
  });
  return rows.map((row) => ({
    kind: "opportunity",
    id: row.id,
    label: row.name,
    detail: `${row.account.name} · ${row.stage.name}`,
  }));
}
