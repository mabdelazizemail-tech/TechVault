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

/* Accounts receivable ------------------------------------------------------ */

export {
  createPaymentMethod,
  createTaxRate,
  getArSettings,
  listPaymentMethods,
  listTaxRates,
  updateArSettings,
  updateNumberSeries,
  updatePaymentMethod,
  updateTaxRate,
} from "../services/finance/ar/settings-service";

export {
  getArCustomer,
  listArCustomers,
  searchArCustomers,
  updateArCustomerProfile,
} from "../services/finance/ar/customer-service";

export { getAgingReport } from "../services/finance/ar/aging-service";

export {
  approveInvoice,
  cancelInvoice,
  createInvoice,
  deleteInvoice,
  getInvoice,
  listInvoices,
  listOpenInvoices,
  postInvoice,
  rejectInvoice,
  submitInvoice,
  updateInvoice,
} from "../services/finance/ar/invoice-service";

export {
  allocateReceipt,
  cancelReceipt,
  createReceipt,
  deleteReceipt,
  getReceipt,
  listReceipts,
  postReceipt,
  unallocateReceipt,
  updateReceipt,
} from "../services/finance/ar/receipt-service";
