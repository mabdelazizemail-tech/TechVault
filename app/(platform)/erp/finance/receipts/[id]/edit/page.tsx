import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { BreadcrumbTitle } from "@/components/shell/breadcrumbs";
import { PageHeader } from "@/components/ui/primitives";
import { ERP_PERMISSIONS } from "@/modules/erp/contracts/permissions";
import {
  getReceipt,
  listAccountOptions,
  listPaymentMethods,
} from "@/modules/erp/contracts/service";
import { todayInCairo } from "@/modules/erp/ui/format";
import { orNotFound } from "@/modules/erp/ui/page-helpers";
import { ReceiptForm } from "@/modules/erp/ui/receipt-form";
import { getActor } from "@/platform/auth/current-user";
import { canAll } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Edit receipt" };

export default async function EditReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await getActor();
  const [receipt, rights] = await Promise.all([
    orNotFound(getReceipt(actor, id)),
    canAll(actor, [ERP_PERMISSIONS.AR_RECEIPT_UPDATE, ERP_PERMISSIONS.ACCOUNT_READ]),
  ]);
  if (rights[ERP_PERMISSIONS.AR_RECEIPT_UPDATE] !== true) notFound();
  if (receipt.status !== "DRAFT") redirect(`/erp/finance/receipts/${id}`);

  const [methods, accounts] = await Promise.all([
    listPaymentMethods(actor, { activeOnly: true }),
    rights[ERP_PERMISSIONS.ACCOUNT_READ] === true
      ? listAccountOptions(actor, { postable: true })
      : Promise.resolve([]),
  ]);

  return (
    <div>
      <BreadcrumbTitle segment={id} label="Draft receipt" />
      <PageHeader title="Edit draft receipt" description={receipt.customer.name} />
      <ReceiptForm
        mode="edit"
        receiptId={id}
        paymentMethods={methods}
        depositAccounts={accounts.filter((account) => account.type === "ASSET")}
        defaultDate={todayInCairo()}
        initial={{
          customer: receipt.customer,
          receiptDate: receipt.receiptDate,
          amountMinor: receipt.amountMinor,
          paymentMethodId: receipt.paymentMethod.id,
          depositAccountId: receipt.depositAccount.id,
          reference: receipt.reference,
          notes: receipt.notes,
        }}
      />
    </div>
  );
}
