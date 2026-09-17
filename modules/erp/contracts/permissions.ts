import type { PermissionDefinition } from "@/platform/authz/types";

/**
 * Permissions owned by ERP (CLAUDE.md §11.2), Phase 1: finance foundation.
 *
 * Declared here, assembled into the platform catalogue in `modules/catalogue.ts`,
 * seeded into `iam.permissions`. Import the constant — never write the string.
 *
 * Posting, reversing, closing and reopening are finance controls with their own
 * actions (ADR-022). The evaluator matches keys exactly and implies nothing between
 * them: holding `erp.journal.post` never lets anyone reverse, and closing a period
 * never lets anyone reopen one.
 */
export const ERP_PERMISSIONS = {
  ACCESS: "erp.module.access",

  ACCOUNT_READ: "erp.account.read",
  ACCOUNT_CREATE: "erp.account.create",
  ACCOUNT_UPDATE: "erp.account.update",
  ACCOUNT_ADMINISTER: "erp.account.administer",

  COST_CENTRE_READ: "erp.cost_centre.read",
  COST_CENTRE_CREATE: "erp.cost_centre.create",
  COST_CENTRE_UPDATE: "erp.cost_centre.update",

  PERIOD_READ: "erp.period.read",
  PERIOD_CREATE: "erp.period.create",
  PERIOD_CLOSE: "erp.period.close",
  PERIOD_REOPEN: "erp.period.reopen",

  FISCAL_YEAR_CLOSE: "erp.fiscal_year.close",
  FISCAL_YEAR_REOPEN: "erp.fiscal_year.reopen",

  JOURNAL_READ: "erp.journal.read",
  JOURNAL_CREATE: "erp.journal.create",
  JOURNAL_UPDATE: "erp.journal.update",
  JOURNAL_DELETE: "erp.journal.delete",
  JOURNAL_POST: "erp.journal.post",
  JOURNAL_REVERSE: "erp.journal.reverse",

  FINANCE_SETTINGS_ADMINISTER: "erp.finance_settings.administer",

  AR_INVOICE_READ: "erp.ar_invoice.read",
  AR_INVOICE_CREATE: "erp.ar_invoice.create",
  AR_INVOICE_UPDATE: "erp.ar_invoice.update",
  AR_INVOICE_APPROVE: "erp.ar_invoice.approve",
  AR_INVOICE_POST: "erp.ar_invoice.post",
  AR_INVOICE_CANCEL: "erp.ar_invoice.cancel",

  AR_CREDIT_NOTE_READ: "erp.ar_credit_note.read",
  AR_CREDIT_NOTE_CREATE: "erp.ar_credit_note.create",
  AR_CREDIT_NOTE_UPDATE: "erp.ar_credit_note.update",
  AR_CREDIT_NOTE_APPROVE: "erp.ar_credit_note.approve",
  AR_CREDIT_NOTE_POST: "erp.ar_credit_note.post",
  AR_CREDIT_NOTE_CANCEL: "erp.ar_credit_note.cancel",

  AR_RECEIPT_READ: "erp.ar_receipt.read",
  AR_RECEIPT_CREATE: "erp.ar_receipt.create",
  AR_RECEIPT_UPDATE: "erp.ar_receipt.update",
  AR_RECEIPT_POST: "erp.ar_receipt.post",
  AR_RECEIPT_ALLOCATE: "erp.ar_receipt.allocate",
  AR_RECEIPT_CANCEL: "erp.ar_receipt.cancel",

  AR_CUSTOMER_READ: "erp.ar_customer.read",
  AR_CUSTOMER_UPDATE: "erp.ar_customer.update",
  AR_AGING_READ: "erp.ar_aging.read",
  AR_SETTINGS_ADMINISTER: "erp.ar_settings.administer",

  // Accounts payable (ADR-033).
  AP_VENDOR_READ: "erp.ap_vendor.read",
  AP_VENDOR_CREATE: "erp.ap_vendor.create",
  AP_VENDOR_UPDATE: "erp.ap_vendor.update",

  AP_BILL_READ: "erp.ap_bill.read",
  AP_BILL_CREATE: "erp.ap_bill.create",
  AP_BILL_UPDATE: "erp.ap_bill.update",
  AP_BILL_APPROVE: "erp.ap_bill.approve",
  AP_BILL_POST: "erp.ap_bill.post",
  AP_BILL_CANCEL: "erp.ap_bill.cancel",

  AP_PAYMENT_READ: "erp.ap_payment.read",
  AP_PAYMENT_CREATE: "erp.ap_payment.create",
  AP_PAYMENT_UPDATE: "erp.ap_payment.update",
  AP_PAYMENT_APPROVE: "erp.ap_payment.approve",
  AP_PAYMENT_POST: "erp.ap_payment.post",
  AP_PAYMENT_CANCEL: "erp.ap_payment.cancel",

  AP_AGING_READ: "erp.ap_aging.read",
  AP_SETTINGS_ADMINISTER: "erp.ap_settings.administer",
} as const;

type ErpPermissionKey = (typeof ERP_PERMISSIONS)[keyof typeof ERP_PERMISSIONS];

function define(
  key: ErpPermissionKey,
  action: PermissionDefinition["action"],
  description: string,
): PermissionDefinition {
  const resource = key.split(".")[1] ?? "module";
  return { key, module: "erp", resource, action, description };
}

export const ERP_PERMISSION_DEFINITIONS: readonly PermissionDefinition[] = [
  define(ERP_PERMISSIONS.ACCESS, "ACCESS", "Open ERP finance."),

  define(
    ERP_PERMISSIONS.ACCOUNT_READ,
    "READ",
    "View the chart of accounts and account activity.",
  ),
  define(
    ERP_PERMISSIONS.ACCOUNT_CREATE,
    "CREATE",
    "Add accounts to the chart of accounts.",
  ),
  define(
    ERP_PERMISSIONS.ACCOUNT_UPDATE,
    "UPDATE",
    "Edit accounts: names, description, parent, type and whether they take postings.",
  ),
  define(
    ERP_PERMISSIONS.ACCOUNT_ADMINISTER,
    "ADMINISTER",
    "Activate and deactivate accounts.",
  ),

  define(ERP_PERMISSIONS.COST_CENTRE_READ, "READ", "View cost centres."),
  define(ERP_PERMISSIONS.COST_CENTRE_CREATE, "CREATE", "Add cost centres."),
  define(
    ERP_PERMISSIONS.COST_CENTRE_UPDATE,
    "UPDATE",
    "Edit, activate and deactivate cost centres.",
  ),

  define(ERP_PERMISSIONS.PERIOD_READ, "READ", "View accounting periods."),
  define(ERP_PERMISSIONS.PERIOD_CREATE, "CREATE", "Create accounting periods."),
  define(
    ERP_PERMISSIONS.PERIOD_CLOSE,
    "CLOSE",
    "Close an accounting period, which stops all posting into it.",
  ),
  define(
    ERP_PERMISSIONS.PERIOD_REOPEN,
    "REOPEN",
    "Reopen a closed accounting period. Every reopening is audited with a reason.",
  ),
  define(
    ERP_PERMISSIONS.FISCAL_YEAR_CLOSE,
    "CLOSE",
    "Close a fiscal year: move its profit or loss into retained earnings and stop all posting into it.",
  ),
  define(
    ERP_PERMISSIONS.FISCAL_YEAR_REOPEN,
    "REOPEN",
    "Reopen a closed fiscal year by reversing its close. Every reopening is audited with a reason.",
  ),

  define(ERP_PERMISSIONS.JOURNAL_READ, "READ", "View journal entries."),
  define(ERP_PERMISSIONS.JOURNAL_CREATE, "CREATE", "Create draft journal entries."),
  define(ERP_PERMISSIONS.JOURNAL_UPDATE, "UPDATE", "Edit draft journal entries."),
  define(ERP_PERMISSIONS.JOURNAL_DELETE, "DELETE", "Delete draft journal entries."),
  define(
    ERP_PERMISSIONS.JOURNAL_POST,
    "POST",
    "Post journal entries to the ledger. A posted entry can never be changed.",
  ),
  define(
    ERP_PERMISSIONS.JOURNAL_REVERSE,
    "REVERSE",
    "Reverse posted journal entries with an equal and opposite entry.",
  ),
  define(
    ERP_PERMISSIONS.FINANCE_SETTINGS_ADMINISTER,
    "ADMINISTER",
    "Configure finance: whether people may post journal entries they created or edited, and the retained earnings and opening balance accounts.",
  ),

  define(ERP_PERMISSIONS.AR_INVOICE_READ, "READ", "View customer invoices."),
  define(ERP_PERMISSIONS.AR_INVOICE_CREATE, "CREATE", "Create draft customer invoices."),
  define(
    ERP_PERMISSIONS.AR_INVOICE_UPDATE,
    "UPDATE",
    "Edit, submit and delete draft customer invoices.",
  ),
  define(
    ERP_PERMISSIONS.AR_INVOICE_APPROVE,
    "APPROVE",
    "Approve or reject submitted customer invoices.",
  ),
  define(
    ERP_PERMISSIONS.AR_INVOICE_POST,
    "POST",
    "Post approved invoices to the ledger, which gives them their invoice number.",
  ),
  define(
    ERP_PERMISSIONS.AR_INVOICE_CANCEL,
    "CANCEL",
    "Cancel unposted invoices, and void unpaid posted invoices by reversal.",
  ),

  define(ERP_PERMISSIONS.AR_CREDIT_NOTE_READ, "READ", "View credit notes."),
  define(
    ERP_PERMISSIONS.AR_CREDIT_NOTE_CREATE,
    "CREATE",
    "Raise draft credit notes against posted invoices.",
  ),
  define(
    ERP_PERMISSIONS.AR_CREDIT_NOTE_UPDATE,
    "UPDATE",
    "Edit, submit and delete draft credit notes.",
  ),
  define(
    ERP_PERMISSIONS.AR_CREDIT_NOTE_APPROVE,
    "APPROVE",
    "Approve or reject submitted credit notes.",
  ),
  define(
    ERP_PERMISSIONS.AR_CREDIT_NOTE_POST,
    "POST",
    "Post approved credit notes, which credits the invoice and gives them their number.",
  ),
  define(
    ERP_PERMISSIONS.AR_CREDIT_NOTE_CANCEL,
    "CANCEL",
    "Cancel unposted credit notes, and void posted ones by reversal.",
  ),
  define(
    ERP_PERMISSIONS.AR_RECEIPT_READ,
    "READ",
    "View customer receipts and allocations.",
  ),
  define(ERP_PERMISSIONS.AR_RECEIPT_CREATE, "CREATE", "Record draft customer receipts."),
  define(
    ERP_PERMISSIONS.AR_RECEIPT_UPDATE,
    "UPDATE",
    "Edit and delete draft customer receipts.",
  ),
  define(
    ERP_PERMISSIONS.AR_RECEIPT_POST,
    "POST",
    "Post customer receipts to the ledger.",
  ),
  define(
    ERP_PERMISSIONS.AR_RECEIPT_ALLOCATE,
    "ALLOCATE",
    "Allocate posted receipts to invoices, and remove allocations.",
  ),
  define(
    ERP_PERMISSIONS.AR_RECEIPT_CANCEL,
    "CANCEL",
    "Cancel draft receipts, and void unallocated posted receipts by reversal.",
  ),

  define(
    ERP_PERMISSIONS.AR_CUSTOMER_READ,
    "READ",
    "View customer balances, statements and billing profiles.",
  ),
  define(
    ERP_PERMISSIONS.AR_CUSTOMER_UPDATE,
    "UPDATE",
    "Set a customer's payment terms, credit limit and receivable account.",
  ),
  define(
    ERP_PERMISSIONS.AR_AGING_READ,
    "READ",
    "View the accounts receivable aging report.",
  ),
  define(
    ERP_PERMISSIONS.AR_SETTINGS_ADMINISTER,
    "ADMINISTER",
    "Configure accounts receivable: tax rates, payment methods, numbering, approval rules and aging buckets.",
  ),

  define(
    ERP_PERMISSIONS.AP_VENDOR_READ,
    "READ",
    "View vendors, their balances and their bills and payments.",
  ),
  define(ERP_PERMISSIONS.AP_VENDOR_CREATE, "CREATE", "Add vendors."),
  define(
    ERP_PERMISSIONS.AP_VENDOR_UPDATE,
    "UPDATE",
    "Edit vendors: details, payment terms, accounts, and whether they are active.",
  ),

  define(ERP_PERMISSIONS.AP_BILL_READ, "READ", "View vendor bills."),
  define(ERP_PERMISSIONS.AP_BILL_CREATE, "CREATE", "Enter draft vendor bills."),
  define(
    ERP_PERMISSIONS.AP_BILL_UPDATE,
    "UPDATE",
    "Edit, submit and delete draft vendor bills.",
  ),
  define(
    ERP_PERMISSIONS.AP_BILL_APPROVE,
    "APPROVE",
    "Approve or reject submitted vendor bills.",
  ),
  define(
    ERP_PERMISSIONS.AP_BILL_POST,
    "POST",
    "Post approved bills to the ledger, which gives them their bill number.",
  ),
  define(
    ERP_PERMISSIONS.AP_BILL_CANCEL,
    "CANCEL",
    "Cancel unposted bills, and void unpaid posted bills by reversal.",
  ),

  define(ERP_PERMISSIONS.AP_PAYMENT_READ, "READ", "View supplier payments."),
  define(
    ERP_PERMISSIONS.AP_PAYMENT_CREATE,
    "CREATE",
    "Prepare draft supplier payments against posted bills.",
  ),
  define(
    ERP_PERMISSIONS.AP_PAYMENT_UPDATE,
    "UPDATE",
    "Edit, submit and delete draft supplier payments.",
  ),
  define(
    ERP_PERMISSIONS.AP_PAYMENT_APPROVE,
    "APPROVE",
    "Approve or reject submitted supplier payments.",
  ),
  define(
    ERP_PERMISSIONS.AP_PAYMENT_POST,
    "POST",
    "Post approved supplier payments, which settles their bills and books the withholding tax.",
  ),
  define(
    ERP_PERMISSIONS.AP_PAYMENT_CANCEL,
    "CANCEL",
    "Cancel unposted payments, and void posted payments by reversal.",
  ),

  define(
    ERP_PERMISSIONS.AP_AGING_READ,
    "READ",
    "View the accounts payable aging report.",
  ),
  define(
    ERP_PERMISSIONS.AP_SETTINGS_ADMINISTER,
    "ADMINISTER",
    "Configure accounts payable: payable account, approval rules for bills and payments, withholding tax rates and aging buckets.",
  ),
];

/** Role key for the seeded finance administrator: every ERP finance permission. */
export const ERP_FINANCE_ADMIN_ROLE = "finance-admin";

export const ERP_FINANCE_ADMIN_PERMISSIONS: readonly string[] =
  Object.values(ERP_PERMISSIONS);

/** Role key for the seeded accountant. */
export const ERP_ACCOUNTANT_ROLE = "accountant";

/**
 * Day-to-day bookkeeping: journals end to end, and maintaining accounts and cost
 * centres. Not creating, closing or reopening periods, and not deactivating
 * accounts — those are controls a finance administrator holds.
 */
export const ERP_ACCOUNTANT_PERMISSIONS: readonly string[] = [
  ERP_PERMISSIONS.ACCESS,
  ERP_PERMISSIONS.ACCOUNT_READ,
  ERP_PERMISSIONS.ACCOUNT_CREATE,
  ERP_PERMISSIONS.ACCOUNT_UPDATE,
  ERP_PERMISSIONS.COST_CENTRE_READ,
  ERP_PERMISSIONS.COST_CENTRE_CREATE,
  ERP_PERMISSIONS.COST_CENTRE_UPDATE,
  ERP_PERMISSIONS.PERIOD_READ,
  ERP_PERMISSIONS.JOURNAL_READ,
  ERP_PERMISSIONS.JOURNAL_CREATE,
  ERP_PERMISSIONS.JOURNAL_UPDATE,
  ERP_PERMISSIONS.JOURNAL_DELETE,
  ERP_PERMISSIONS.JOURNAL_POST,
  ERP_PERMISSIONS.JOURNAL_REVERSE,
  // Accounts receivable: day-to-day billing and cash application. Approving and
  // cancelling invoices, voiding receipts, customer credit terms and AR settings
  // stay with a finance administrator.
  ERP_PERMISSIONS.AR_INVOICE_READ,
  ERP_PERMISSIONS.AR_INVOICE_CREATE,
  ERP_PERMISSIONS.AR_INVOICE_UPDATE,
  ERP_PERMISSIONS.AR_INVOICE_POST,
  ERP_PERMISSIONS.AR_CREDIT_NOTE_READ,
  ERP_PERMISSIONS.AR_CREDIT_NOTE_CREATE,
  ERP_PERMISSIONS.AR_CREDIT_NOTE_UPDATE,
  ERP_PERMISSIONS.AR_CREDIT_NOTE_POST,
  ERP_PERMISSIONS.AR_RECEIPT_READ,
  ERP_PERMISSIONS.AR_RECEIPT_CREATE,
  ERP_PERMISSIONS.AR_RECEIPT_UPDATE,
  ERP_PERMISSIONS.AR_RECEIPT_POST,
  ERP_PERMISSIONS.AR_RECEIPT_ALLOCATE,
  ERP_PERMISSIONS.AR_CUSTOMER_READ,
  ERP_PERMISSIONS.AR_AGING_READ,
  // Accounts payable: day-to-day vendors, bills and payments. Approving, cancelling
  // and AP settings stay with a finance administrator.
  ERP_PERMISSIONS.AP_VENDOR_READ,
  ERP_PERMISSIONS.AP_VENDOR_CREATE,
  ERP_PERMISSIONS.AP_VENDOR_UPDATE,
  ERP_PERMISSIONS.AP_BILL_READ,
  ERP_PERMISSIONS.AP_BILL_CREATE,
  ERP_PERMISSIONS.AP_BILL_UPDATE,
  ERP_PERMISSIONS.AP_BILL_POST,
  ERP_PERMISSIONS.AP_PAYMENT_READ,
  ERP_PERMISSIONS.AP_PAYMENT_CREATE,
  ERP_PERMISSIONS.AP_PAYMENT_UPDATE,
  ERP_PERMISSIONS.AP_PAYMENT_POST,
  ERP_PERMISSIONS.AP_AGING_READ,
];

/** Role key for the seeded ERP Finance section role. */
export const ERP_USER_ROLE = "erp-user";

/**
 * What ticking "ERP Finance" gives someone: the section appears and they can read
 * the books — the chart of accounts, journals, the financial reports, periods,
 * cost centres, invoices, credit notes, receipts, customers and aging. Nothing
 * writes. Recording and posting stays with the Accountant, and the controls with
 * the Finance administrator (ADR-030).
 */
export const ERP_VIEWER_PERMISSIONS: readonly string[] = [
  ERP_PERMISSIONS.ACCESS,
  ERP_PERMISSIONS.ACCOUNT_READ,
  ERP_PERMISSIONS.COST_CENTRE_READ,
  ERP_PERMISSIONS.PERIOD_READ,
  ERP_PERMISSIONS.JOURNAL_READ,
  ERP_PERMISSIONS.AR_INVOICE_READ,
  ERP_PERMISSIONS.AR_CREDIT_NOTE_READ,
  ERP_PERMISSIONS.AR_RECEIPT_READ,
  ERP_PERMISSIONS.AR_CUSTOMER_READ,
  ERP_PERMISSIONS.AR_AGING_READ,
  ERP_PERMISSIONS.AP_VENDOR_READ,
  ERP_PERMISSIONS.AP_BILL_READ,
  ERP_PERMISSIONS.AP_PAYMENT_READ,
  ERP_PERMISSIONS.AP_AGING_READ,
];
