import { prisma } from "@/lib/prisma";

/**
 * Company references for other modules (CLAUDE.md §5 rule 1, ADR-023).
 *
 * CRM owns the customer record. A module that bills or reports on customers — ERP
 * accounts receivable — stores only `crm_account_id` and needs two things from CRM:
 * whether a company exists, and what it is called. These lookups answer exactly that
 * and disclose nothing else: no contacts, no address, no owner, no pipeline.
 *
 * They check no CRM permission. The calling module authorises its own operation
 * first (an AR clerk may bill every customer without holding CRM access), and a name
 * is the least a billing screen can show. Anything richer goes through the
 * permission-checked CRM services.
 */

export type CrmAccountReference = {
  id: string;
  name: string;
  /** False when the company was deleted in CRM (or never existed). */
  exists: boolean;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IDS = 500;

/** References for the given company ids, in the order given; unknown ids come back as not existing. */
export async function getAccountReferences(
  ids: readonly string[],
): Promise<CrmAccountReference[]> {
  const wanted = [...new Set(ids.filter((id) => UUID_PATTERN.test(id)))].slice(
    0,
    MAX_IDS,
  );
  if (wanted.length === 0) return [];

  const rows = await prisma.crmAccount.findMany({
    where: { id: { in: wanted } },
    select: { id: true, name: true, deletedAt: true },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));

  return wanted.map((id) => {
    const row = byId.get(id);
    return row === undefined
      ? { id, name: "Unknown company", exists: false }
      : { id, name: row.name, exists: row.deletedAt === null };
  });
}

/** Live companies whose name contains the query, alphabetically — for pickers. */
export async function searchAccountReferences(
  query: string,
  limit = 20,
): Promise<CrmAccountReference[]> {
  const term = query.trim().slice(0, 100);
  const rows = await prisma.crmAccount.findMany({
    where: {
      deletedAt: null,
      ...(term === "" ? {} : { name: { contains: term, mode: "insensitive" } }),
    },
    orderBy: { name: "asc" },
    take: Math.min(Math.max(limit, 1), 50),
    select: { id: true, name: true },
  });
  return rows.map((row) => ({ id: row.id, name: row.name, exists: true }));
}
