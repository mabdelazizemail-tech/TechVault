/**
 * CRM data transfer objects and vocabulary (CLAUDE.md §9 rule 5).
 *
 * Every screen receives these shapes, never a Prisma entity. The string unions
 * mirror the `crm` enums so client components can use them without importing the
 * database client.
 */

/* -------------------------------------------------------------------------- */
/* Money                                                                      */
/* -------------------------------------------------------------------------- */

export const CRM_CURRENCIES = ["EGP", "USD"] as const;
export type CrmCurrency = (typeof CRM_CURRENCIES)[number];
export const CRM_DEFAULT_CURRENCY: CrmCurrency = "EGP";

/**
 * An amount in one currency. Totals are always a LIST of these — one per currency
 * present — because adding EGP to USD produces a number that means nothing.
 */
export type MoneyTotal = { currency: CrmCurrency; amountMinor: number };

/* -------------------------------------------------------------------------- */
/* Vocabulary                                                                 */
/* -------------------------------------------------------------------------- */

export const LEAD_STATUSES = [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "CONVERTED",
  "DISQUALIFIED",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  CONVERTED: "Converted",
  DISQUALIFIED: "Disqualified",
};

/** The forward progression shown on the lead page. Disqualified sits outside it. */
export const LEAD_PROGRESSION: readonly LeadStatus[] = [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "CONVERTED",
];

export const LEAD_SOURCES = [
  "WEBSITE",
  "REFERRAL",
  "LINKEDIN",
  "ADVERTISEMENT",
  "EVENT",
  "COLD_OUTREACH",
  "PARTNER",
  "OTHER",
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  WEBSITE: "Website",
  REFERRAL: "Referral",
  LINKEDIN: "LinkedIn",
  ADVERTISEMENT: "Advertisement",
  EVENT: "Event",
  COLD_OUTREACH: "Cold outreach",
  PARTNER: "Partner",
  OTHER: "Other",
};

export const PURCHASE_TIMELINES = [
  "IMMEDIATE",
  "WITHIN_3_MONTHS",
  "WITHIN_6_MONTHS",
  "WITHIN_12_MONTHS",
  "OVER_12_MONTHS",
  "UNKNOWN",
] as const;
export type PurchaseTimeline = (typeof PURCHASE_TIMELINES)[number];

export const PURCHASE_TIMELINE_LABELS: Record<PurchaseTimeline, string> = {
  IMMEDIATE: "Immediately",
  WITHIN_3_MONTHS: "1–3 months",
  WITHIN_6_MONTHS: "3–6 months",
  WITHIN_12_MONTHS: "6–12 months",
  OVER_12_MONTHS: "12+ months",
  UNKNOWN: "Not sure yet",
};

export const DECISION_MAKER_OPTIONS = ["YES", "NO", "UNKNOWN"] as const;
export type DecisionMaker = (typeof DECISION_MAKER_OPTIONS)[number];

export const DECISION_MAKER_LABELS: Record<DecisionMaker, string> = {
  YES: "Yes",
  NO: "No",
  UNKNOWN: "Not sure",
};

export const COMPANY_SIZES = [
  "1-10",
  "11-50",
  "51-200",
  "201-500",
  "501-1000",
  "1000+",
] as const;
export type CompanySize = (typeof COMPANY_SIZES)[number];

export const INDUSTRIES = [
  "Banking",
  "Financial services",
  "Insurance",
  "Government",
  "Telecommunications",
  "Healthcare",
  "Education",
  "Manufacturing",
  "Retail",
  "Logistics",
  "Energy",
  "Software",
  "Professional services",
  "Media",
  "Real estate",
  "Other",
] as const;

export const SALES_CHANNELS = ["DIRECT", "INDIRECT"] as const;
export type SalesChannel = (typeof SALES_CHANNELS)[number];

export const SALES_CHANNEL_LABELS: Record<SalesChannel, string> = {
  DIRECT: "Direct",
  INDIRECT: "Indirect",
};

export const PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_LABELS: Record<Priority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
};

export const LOST_REASONS = [
  "PRICE",
  "COMPETITOR",
  "NO_BUDGET",
  "TIMING",
  "NO_DECISION",
  "PRODUCT_FIT",
  "OTHER",
] as const;
export type LostReason = (typeof LOST_REASONS)[number];

export const LOST_REASON_LABELS: Record<LostReason, string> = {
  PRICE: "Price",
  COMPETITOR: "Competitor",
  NO_BUDGET: "No budget",
  TIMING: "Timing",
  NO_DECISION: "No decision",
  PRODUCT_FIT: "Product fit",
  OTHER: "Other",
};

export type StageKind = "OPEN" | "WON" | "LOST";
export type OpportunityStatus = "OPEN" | "WON" | "LOST";

/** Activity types a person can log. System types are written by the CRM itself. */
export const LOGGABLE_ACTIVITY_TYPES = [
  "CALL",
  "EMAIL",
  "MEETING",
  "TASK",
  "NOTE",
] as const;
export type LoggableActivityType = (typeof LOGGABLE_ACTIVITY_TYPES)[number];
export type ActivityType = LoggableActivityType | "STATUS_CHANGE" | "STAGE_CHANGE";

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  CALL: "Call",
  EMAIL: "Email",
  MEETING: "Meeting",
  TASK: "Task",
  NOTE: "Note",
  STATUS_CHANGE: "Status change",
  STAGE_CHANGE: "Stage change",
};

/* -------------------------------------------------------------------------- */
/* Shared shapes                                                              */
/* -------------------------------------------------------------------------- */

export type UserRef = { id: string; name: string };

export type Paginated<T> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type RecordKind = "lead" | "account" | "contact" | "opportunity";

export type RecordRef = {
  kind: RecordKind;
  id: string;
  label: string;
};

/* -------------------------------------------------------------------------- */
/* Stages                                                                     */
/* -------------------------------------------------------------------------- */

export type StageDto = {
  id: string;
  key: string;
  name: string;
  position: number;
  kind: StageKind;
  defaultProbability: number;
};

/* -------------------------------------------------------------------------- */
/* Leads                                                                      */
/* -------------------------------------------------------------------------- */

export type LeadListItem = {
  id: string;
  name: string;
  company: string;
  email: string | null;
  status: LeadStatus;
  score: number;
  source: LeadSource;
  owner: UserRef | null;
  createdAt: Date;
};

export type LeadDetail = LeadListItem & {
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  phone: string | null;
  website: string | null;
  industry: string | null;
  companySize: string | null;
  country: string | null;
  city: string | null;
  interest: string | null;
  budgetMinor: number | null;
  currency: CrmCurrency;
  timeline: PurchaseTimeline | null;
  decisionMaker: DecisionMaker | null;
  currentSolution: string | null;
  painPoint: string | null;
  statusChangedAt: Date;
  convertedAt: Date | null;
  convertedAccount: RecordRef | null;
  convertedContact: RecordRef | null;
  convertedOpportunity: RecordRef | null;
  updatedAt: Date;
};

/** What conversion would do, shown on the confirmation screen before it happens. */
export type ConversionPreview = {
  lead: LeadDetail;
  /** An existing company matching the lead's company name, if any. */
  matchingAccount: { id: string; name: string } | null;
  /** An existing contact matching the lead's email, if any. */
  matchingContact: { id: string; name: string; accountName: string | null } | null;
  stages: StageDto[];
};

export type ConversionResult = {
  accountId: string;
  contactId: string;
  opportunityId: string | null;
};

/* -------------------------------------------------------------------------- */
/* Accounts and contacts                                                      */
/* -------------------------------------------------------------------------- */

export type AccountListItem = {
  id: string;
  name: string;
  industry: string | null;
  city: string | null;
  country: string | null;
  owner: UserRef | null;
  contactCount: number;
  openOpportunityCount: number;
  pipeline: MoneyTotal[];
  createdAt: Date;
};

export type AccountDetail = AccountListItem & {
  website: string | null;
  companySize: string | null;
  phone: string | null;
  description: string | null;
  activityCount: number;
  contacts: ContactListItem[];
  opportunities: OpportunityListItem[];
  leads: LeadListItem[];
  updatedAt: Date;
};

export type ContactListItem = {
  id: string;
  name: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  account: { id: string; name: string } | null;
  owner: UserRef | null;
  createdAt: Date;
};

export type ContactDetail = ContactListItem & {
  firstName: string;
  lastName: string;
  country: string | null;
  city: string | null;
  opportunities: OpportunityListItem[];
  updatedAt: Date;
};

/* -------------------------------------------------------------------------- */
/* Opportunities                                                              */
/* -------------------------------------------------------------------------- */

export type OpportunityListItem = {
  id: string;
  name: string;
  account: { id: string; name: string };
  primaryContact: { id: string; name: string } | null;
  stage: { id: string; name: string; kind: StageKind };
  status: OpportunityStatus;
  amountMinor: number;
  currency: CrmCurrency;
  closeDate: Date;
  probability: number;
  priority: Priority;
  channel: SalesChannel;
  partnerName: string | null;
  product: string | null;
  owner: UserRef | null;
  industry: string | null;
  source: LeadSource | null;
};

export type OpportunityDetail = OpportunityListItem & {
  description: string | null;
  wonAt: Date | null;
  lostAt: Date | null;
  lostReason: LostReason | null;
  closeNotes: string | null;
  stageChangedAt: Date;
  primaryContactDetail: {
    id: string;
    name: string;
    jobTitle: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PipelineColumn = {
  stage: StageDto;
  count: number;
  totals: MoneyTotal[];
  cards: OpportunityListItem[];
};

export type PipelineSummary = {
  openCount: number;
  open: MoneyTotal[];
  weighted: MoneyTotal[];
  wonThisMonth: MoneyTotal[];
  lostThisMonth: MoneyTotal[];
};

export type PipelineBoard = {
  summary: PipelineSummary;
  columns: PipelineColumn[];
};

/* -------------------------------------------------------------------------- */
/* Activities                                                                 */
/* -------------------------------------------------------------------------- */

export type ActivityDto = {
  id: string;
  type: ActivityType;
  subject: string;
  body: string | null;
  occurredAt: Date;
  durationMinutes: number | null;
  dueAt: Date | null;
  completedAt: Date | null;
  priority: Priority | null;
  assignee: UserRef | null;
  creator: UserRef | null;
  related: RecordRef[];
  metadata: Record<string, unknown> | null;
};

/** What deleting a record takes with it, shown before an administrator confirms. */
export type DeletionImpact = {
  kind: RecordKind;
  id: string;
  label: string;
  contacts: number;
  opportunities: number;
  activities: number;
};

/* -------------------------------------------------------------------------- */
/* Search and dashboard                                                       */
/* -------------------------------------------------------------------------- */

export type SearchHit = RecordRef & { detail: string | null };

export type SearchResults = {
  query: string;
  leads: SearchHit[];
  accounts: SearchHit[];
  contacts: SearchHit[];
  opportunities: SearchHit[];
};

export type CrmDashboard = {
  totalLeads: number;
  newLeads: number;
  qualifiedLeads: number;
  openOpportunities: number;
  pipeline: MoneyTotal[];
  wonCount: number;
  won: MoneyTotal[];
  lostCount: number;
  /** Converted leads ÷ all leads, 0–100, or null when there are no leads. */
  conversionRate: number | null;
  stageBreakdown: { stage: StageDto; count: number; totals: MoneyTotal[] }[];
  recentActivity: ActivityDto[];
  openTasks: ActivityDto[];
};
