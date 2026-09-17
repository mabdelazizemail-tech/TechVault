import type { Actor } from "@/platform/authz/authz";
import { canAllGlobally } from "@/platform/authz/authz";
import { ERP_PERMISSIONS } from "../contracts/permissions";
import {
  listAccountOptions,
  listCostCentreOptions,
  listTaxRates,
} from "../contracts/service";

/**
 * The choices the bill form offers: expense and asset accounts, cost centres, and
 * only the tax rates that name an input tax account — a rate without one cannot be
 * recovered on a purchase (ADR-033).
 */
export async function billFormOptions(actor: Actor) {
  const rights = await canAllGlobally(actor, [
    ERP_PERMISSIONS.ACCOUNT_READ,
    ERP_PERMISSIONS.COST_CENTRE_READ,
  ]);
  const [accounts, taxRates, costCentres] = await Promise.all([
    rights[ERP_PERMISSIONS.ACCOUNT_READ] === true
      ? listAccountOptions(actor, { postable: true })
      : Promise.resolve([]),
    listTaxRates(actor, { activeOnly: true }),
    rights[ERP_PERMISSIONS.COST_CENTRE_READ] === true
      ? listCostCentreOptions(actor)
      : Promise.resolve([]),
  ]);
  return {
    expenseAccounts: accounts.filter(
      (account) => account.type === "EXPENSE" || account.type === "ASSET",
    ),
    taxRates: taxRates.filter((rate) => rate.inputTaxAccount !== null),
    costCentres,
  };
}
