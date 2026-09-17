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

export {
  closeFiscalYear,
  listFiscalYears,
  previewYearEnd,
  reopenFiscalYear,
} from "../services/finance/year-end-service";

export {
  getFinanceSettings,
  getJournalDefaults,
  updateFinanceSettings,
} from "../services/finance/finance-settings-service";

export {
  getBalanceSheet,
  getProfitAndLoss,
  getTrialBalance,
} from "../services/finance/report-service";

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
  approveCreditNote,
  cancelCreditNote,
  createCreditNote,
  deleteCreditNote,
  getCreditNote,
  getCreditableInvoice,
  listCreditNotes,
  postCreditNote,
  rejectCreditNote,
  submitCreditNote,
  updateCreditNote,
} from "../services/finance/ar/credit-note-service";

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

/* Accounts payable (ADR-033) ----------------------------------------------------- */

export {
  createVendor,
  getVendor,
  listVendors,
  searchVendors,
  updateVendor,
} from "../services/finance/ap/vendor-service";

export {
  approveBill,
  cancelBill,
  createBill,
  deleteBill,
  getBill,
  listBills,
  listOpenBills,
  postBill,
  rejectBill,
  submitBill,
  updateBill,
} from "../services/finance/ap/bill-service";

export {
  approvePayment,
  cancelPayment,
  createPayment,
  deletePayment,
  getPayment,
  listPayments,
  postPayment,
  rejectPayment,
  submitPayment,
  updatePayment,
} from "../services/finance/ap/payment-service";

export { getApAgingReport } from "../services/finance/ap/aging-service";

export {
  createWithholdingTaxRate,
  getApSettings,
  listWithholdingTaxRates,
  updateApSettings,
  updateWithholdingTaxRate,
} from "../services/finance/ap/settings-service";
