import type { Actor } from "@/platform/authz/authz";
import { canAllGlobally } from "@/platform/authz/authz";
import { ERP_PERMISSIONS } from "../contracts/permissions";
import { listAccountOptions, listWithholdingTaxRates } from "../contracts/service";

/** The choices the vendor form offers, limited to what the viewer may read. */
export async function vendorFormOptions(actor: Actor) {
  const rights = await canAllGlobally(actor, [
    ERP_PERMISSIONS.ACCOUNT_READ,
    ERP_PERMISSIONS.AP_PAYMENT_READ,
    ERP_PERMISSIONS.AR_CUSTOMER_READ,
  ]);
  const [accounts, withholdingRates] = await Promise.all([
    rights[ERP_PERMISSIONS.ACCOUNT_READ] === true
      ? listAccountOptions(actor, { postable: true })
      : Promise.resolve([]),
    rights[ERP_PERMISSIONS.AP_PAYMENT_READ] === true
      ? listWithholdingTaxRates(actor, { activeOnly: true })
      : Promise.resolve([]),
  ]);
  return {
    payableAccounts: accounts.filter((account) => account.type === "LIABILITY"),
    expenseAccounts: accounts.filter(
      (account) => account.type === "EXPENSE" || account.type === "ASSET",
    ),
    withholdingRates,
    canLinkCrm: rights[ERP_PERMISSIONS.AR_CUSTOMER_READ] === true,
  };
}
