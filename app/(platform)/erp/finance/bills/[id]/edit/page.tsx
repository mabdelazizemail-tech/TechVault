import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { BreadcrumbTitle } from "@/components/shell/breadcrumbs";
import { PageHeader } from "@/components/ui/primitives";
import { ERP_PERMISSIONS } from "@/modules/erp/contracts/permissions";
import { getBill } from "@/modules/erp/contracts/service";
import { BillForm } from "@/modules/erp/ui/bill-form";
import { billFormOptions } from "@/modules/erp/ui/bill-form-options";
import { todayInCairo } from "@/modules/erp/ui/format";
import { orNotFound } from "@/modules/erp/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";
import { canGlobally } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Edit bill" };

/** Only a draft can be edited; a rejected bill returns to draft. */
export default async function EditBillPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await getActor();
  if (!(await canGlobally(actor, ERP_PERMISSIONS.AP_BILL_UPDATE))) notFound();
  const bill = await orNotFound(getBill(actor, id));
  if (bill.status !== "DRAFT") redirect(`/erp/finance/bills/${id}`);
  const options = await billFormOptions(actor);

  return (
    <div>
      <BreadcrumbTitle segment={id} label="Draft bill" />
      <PageHeader title="Edit draft bill" />
      <BillForm
        mode="edit"
        billId={bill.id}
        {...options}
        defaultDate={todayInCairo()}
        initial={{
          vendor: bill.vendor,
          vendorInvoiceNumber: bill.vendorInvoiceNumber,
          billDate: bill.billDate,
          dueDate: bill.dueDate,
          reference: bill.reference,
          notes: bill.notes,
          lines: bill.lines.map((line) => ({
            description: line.description,
            quantity: line.quantity,
            unitPriceMinor: line.unitPriceMinor,
            discountMinor: line.discountMinor,
            taxRateId: line.taxRate?.id ?? null,
            expenseAccountId: line.expenseAccount.id,
            costCentreId: line.costCentre?.id ?? null,
          })),
        }}
      />
    </div>
  );
}
