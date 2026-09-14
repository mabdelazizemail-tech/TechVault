import type { Prisma } from "@prisma/client";

/**
 * Column selections for ERP finance reads. Every query names the columns it needs —
 * never a whole row (CLAUDE.md §21) — and these are shared so a list and its detail
 * screen cannot drift apart.
 */

export const personSelect = { id: true, fullName: true, email: true } as const;

export const accountRefSelect = {
  id: true,
  code: true,
  name: true,
  nameAr: true,
} as const satisfies Prisma.ErpAccountSelect;

export const costCentreRefSelect = {
  id: true,
  code: true,
  name: true,
  nameAr: true,
} as const satisfies Prisma.ErpCostCentreSelect;

export const accountListSelect = {
  ...accountRefSelect,
  type: true,
  normalBalance: true,
  isPostable: true,
  isActive: true,
  parentId: true,
  _count: { select: { children: true } },
} as const satisfies Prisma.ErpAccountSelect;

export const costCentreListSelect = {
  ...costCentreRefSelect,
  isActive: true,
  parentId: true,
  _count: { select: { children: true } },
} as const satisfies Prisma.ErpCostCentreSelect;

export const periodSelect = {
  id: true,
  name: true,
  startDate: true,
  endDate: true,
  status: true,
  closedAt: true,
  reopenedAt: true,
  closer: { select: personSelect },
  reopener: { select: personSelect },
  _count: { select: { entries: true } },
} as const satisfies Prisma.ErpFiscalPeriodSelect;

export const journalListSelect = {
  id: true,
  journalNumber: true,
  entryDate: true,
  description: true,
  reference: true,
  status: true,
  totalMinor: true,
  postedAt: true,
  creator: { select: personSelect },
  reverses: { select: { id: true, journalNumber: true } },
  reversal: { select: { id: true, journalNumber: true } },
  _count: { select: { lines: true } },
} as const satisfies Prisma.ErpJournalEntrySelect;

export type AccountListRow = Prisma.ErpAccountGetPayload<{
  select: typeof accountListSelect;
}>;
export type CostCentreListRow = Prisma.ErpCostCentreGetPayload<{
  select: typeof costCentreListSelect;
}>;
export type PeriodRow = Prisma.ErpFiscalPeriodGetPayload<{ select: typeof periodSelect }>;
export type JournalListRow = Prisma.ErpJournalEntryGetPayload<{
  select: typeof journalListSelect;
}>;
