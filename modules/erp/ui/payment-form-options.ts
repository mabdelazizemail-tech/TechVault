import type { Actor } from "@/platform/authz/authz";
import { canGlobally } from "@/platform/authz/authz";
import { ERP_PERMISSIONS } from "../contracts/permissions";
import {
  listAccountOptions,
  listPaymentMethods,
  listWithholdingTaxRates,
} from "../contracts/service";

/** The choices the payment form offers: methods, bank and cash accounts, withholding rates. */
export async function paymentFormOptions(actor: Actor) {
  const [paymentMethods, accounts, withholdingRates] = await Promise.all([
    listPaymentMethods(actor, { activeOnly: true }),
    (await canGlobally(actor, ERP_PERMISSIONS.ACCOUNT_READ))
      ? listAccountOptions(actor, { postable: true })
      : Promise.resolve([]),
    listWithholdingTaxRates(actor, { activeOnly: true }),
  ]);
  return {
    paymentMethods,
    bankAccounts: accounts.filter((account) => account.type === "ASSET"),
    withholdingRates,
  };
}
