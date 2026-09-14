/**
 * Events the CRM publishes (CLAUDE.md §6.1, §10).
 *
 * Past tense only — an event is a fact. Payloads carry entity IDs and the few
 * fields a subscriber genuinely needs; subscribers that need more call the CRM's
 * public service.
 */
export const CRM_EVENTS = {
  LEAD_CREATED: "crm.LeadCreated",
  LEAD_UPDATED: "crm.LeadUpdated",
  LEAD_STATUS_CHANGED: "crm.LeadStatusChanged",
  LEAD_CONVERTED: "crm.LeadConverted",
  CUSTOMER_CREATED: "crm.CustomerCreated",
  CUSTOMER_UPDATED: "crm.CustomerUpdated",
  CONTACT_CREATED: "crm.ContactCreated",
  CONTACT_UPDATED: "crm.ContactUpdated",
  OPPORTUNITY_CREATED: "crm.OpportunityCreated",
  OPPORTUNITY_UPDATED: "crm.OpportunityUpdated",
  OPPORTUNITY_STAGE_CHANGED: "crm.OpportunityStageChanged",
  OPPORTUNITY_WON: "crm.OpportunityWon",
  OPPORTUNITY_LOST: "crm.OpportunityLost",
  ACTIVITY_LOGGED: "crm.ActivityLogged",
} as const;
