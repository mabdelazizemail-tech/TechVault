/**
 * ERP's public service surface (CLAUDE.md §4). Every function checks its own
 * permission; callers pass an `Actor` and trust nothing else.
 */

export {
  createAccount,
  getAccount,
  listAccountActivity,
  listAccountOptions,
  listAccounts,
  setAccountActive,
  updateAccount,
} from "../services/finance/account-service";

export {
  createCostCentre,
  listCostCentreOptions,
  listCostCentres,
  updateCostCentre,
} from "../services/finance/cost-centre-service";

export {
  closePeriod,
  createPeriod,
  listPeriods,
  reopenPeriod,
} from "../services/finance/period-service";

export {
  createJournal,
  deleteJournal,
  getJournal,
  listJournals,
  postJournal,
  reverseJournal,
  updateJournal,
} from "../services/finance/journal-service";

export { getFinanceOverview } from "../services/finance/overview-service";
