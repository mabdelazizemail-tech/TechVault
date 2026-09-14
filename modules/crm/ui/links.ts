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
