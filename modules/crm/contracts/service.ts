/**
 * The CRM module's public service surface (CLAUDE.md §4).
 *
 * Routes and other modules import CRM operations from HERE — never from
 * `services/` or `repositories/`, which the lint boundary forbids. Every function
 * below checks permissions itself; callers pass an `Actor` and trust nothing else.
 */

export {
  bulkUpdateLeads,
  convertLead,
  createLead,
  getConversionPreview,
  getLead,
  listLeads,
  setLeadStatus,
  updateLead,
  type CreateLeadResult,
  type LeadListFilters,
} from "../services/lead-service";

export {
  createAccount,
  createContact,
  getAccount,
  getContact,
  listAccountOptions,
  listAccounts,
  listContactOptions,
  listContacts,
  updateAccount,
  updateContact,
} from "../services/account-contact-service";

export {
  createOpportunity,
  getOpportunity,
  getPipeline,
  listOpportunities,
  listStages,
  moveOpportunity,
  updateOpportunity,
} from "../services/opportunity-service";

export {
  listActivities,
  listTimeline,
  logActivity,
  setTaskCompleted,
  type ActivityView,
} from "../services/activity-service";

export { searchCrm } from "../services/search-service";
export { getCrmDashboard } from "../services/dashboard-service";
