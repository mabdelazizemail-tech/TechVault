import type { RecordKind, RecordRef } from "../contracts/types";

const RECORD_PATH: Record<RecordKind, string> = {
  lead: "/crm/leads",
  account: "/crm/accounts",
  contact: "/crm/contacts",
  opportunity: "/crm/opportunities",
};

/** The detail page of any CRM record. */
export function recordHref(ref: Pick<RecordRef, "kind" | "id">): string {
  return `${RECORD_PATH[ref.kind]}/${ref.id}`;
}

/** The list page of a CRM record type — where a deleted record's page sends you. */
export function recordListHref(kind: RecordKind): string {
  return RECORD_PATH[kind];
}
