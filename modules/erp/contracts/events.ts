/**
 * Events ERP finance publishes (CLAUDE.md §6.2, §10), written to the transactional
 * outbox inside the business transaction.
 *
 * Past tense only — an event is a fact. Payloads carry ids and the few fields a
 * subscriber needs to decide whether to care; amounts are deliberately left out, and
 * a subscriber that needs figures reads them through ERP's service. Drafts publish
 * nothing: a draft is not yet a fact anyone else should react to.
 */
export const ERP_EVENTS = {
  ACCOUNT_CREATED: "erp.AccountCreated",
  ACCOUNT_UPDATED: "erp.AccountUpdated",
  COST_CENTRE_CREATED: "erp.CostCentreCreated",
  COST_CENTRE_UPDATED: "erp.CostCentreUpdated",
  PERIOD_CREATED: "erp.PeriodCreated",
  PERIOD_CLOSED: "erp.PeriodClosed",
  PERIOD_REOPENED: "erp.PeriodReopened",
  JOURNAL_ENTRY_POSTED: "erp.JournalEntryPosted",
  JOURNAL_ENTRY_REVERSED: "erp.JournalEntryReversed",
} as const;

export type JournalEntryPostedPayload = {
  journalEntryId: string;
  journalNumber: string;
  /** ISO date, "YYYY-MM-DD". */
  entryDate: string;
  fiscalPeriodId: string;
  /** Set when the posted entry is itself a reversal. */
  reversesEntryId: string | null;
};

export type JournalEntryReversedPayload = {
  journalEntryId: string;
  journalNumber: string;
  reversalEntryId: string;
  reversalJournalNumber: string;
};

export type PeriodClosedPayload = {
  fiscalPeriodId: string;
  name: string;
  startDate: string;
  endDate: string;
};
