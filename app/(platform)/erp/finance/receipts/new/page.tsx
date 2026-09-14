import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/primitives";
import { ERP_PERMISSIONS } from "@/modules/erp/contracts/permissions";
import { listAccountOptions, listPaymentMethods } from "@/modules/erp/contracts/service";
import { todayInCairo } from "@/modules/erp/ui/format";
import { ReceiptForm } from "@/modules/erp/ui/receipt-form";
import { getActor } from "@/platform/auth/current-user";
import { canAll } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "New receipt" };

export default async function NewReceiptPage() {
  const actor = await getActor();
  const rights = await canAll(actor, [
    ERP_PERMISSIONS.AR_RECEIPT_CREATE,
    ERP_PERMISSIONS.ACCOUNT_READ,
  ]);
  if (rights[ERP_PERMISSIONS.AR_RECEIPT_CREATE] !== true) notFound();

  const [methods, accounts] = await Promise.all([
    listPaymentMethods(actor, { activeOnly: true }),
    rights[ERP_PERMISSIONS.ACCOUNT_READ] === true
      ? listAccountOptions(actor, { postable: true })
      : Promise.resolve([]),
  ]);

  return (
    <div>
      <PageHeader
        title="New receipt"
        description="Saved as a draft. Post it, then allocate it to the customer's invoices."
      />
      <ReceiptForm
        mode="create"
        paymentMethods={methods}
        depositAccounts={accounts.filter((account) => account.type === "ASSET")}
        defaultDate={todayInCairo()}
      />
    </div>
  );
}
