import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { BreadcrumbTitle } from "@/components/shell/breadcrumbs";
import { PageHeader } from "@/components/ui/primitives";
import { ERP_PERMISSIONS } from "@/modules/erp/contracts/permissions";
import { getPayment, listOpenBills } from "@/modules/erp/contracts/service";
import type { OpenBillOption } from "@/modules/erp/contracts/types";
import { todayInCairo } from "@/modules/erp/ui/format";
import { orNotFound } from "@/modules/erp/ui/page-helpers";
import { PaymentForm } from "@/modules/erp/ui/payment-form";
import { paymentFormOptions } from "@/modules/erp/ui/payment-form-options";
import { getActor } from "@/platform/auth/current-user";
import { canGlobally } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Edit payment" };

/** Only a draft can be edited; a rejected payment returns to draft. */
export default async function EditPaymentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await getActor();
  if (!(await canGlobally(actor, ERP_PERMISSIONS.AP_PAYMENT_UPDATE))) notFound();
  const payment = await orNotFound(getPayment(actor, id));
  if (payment.status !== "DRAFT") redirect(`/erp/finance/payments/${id}`);
  const [options, openBills] = await Promise.all([
    paymentFormOptions(actor),
    (await canGlobally(actor, ERP_PERMISSIONS.AP_PAYMENT_CREATE))
      ? listOpenBills(actor, payment.vendor.id)
      : Promise.resolve([]),
  ]);
  const openById = new Map(openBills.map((bill) => [bill.id, bill]));

  return (
    <div>
      <BreadcrumbTitle segment={id} label="Draft payment" />
      <PageHeader title="Edit draft payment" />
      <PaymentForm
        mode="edit"
        paymentId={payment.id}
        {...options}
        initialOpenBills={openBills}
        defaultDate={todayInCairo()}
        initial={{
          vendor: payment.vendor,
          paymentDate: payment.paymentDate,
          paymentMethodId: payment.paymentMethod.id,
          bankAccountId: payment.bankAccount.id,
          reference: payment.reference,
          notes: payment.notes,
          lines: payment.lines.map((line) => ({
            // A bill no longer open keeps its figures; its net share is unknown here,
            // so the preview treats it as having no VAT. The server recalculates.
            bill:
              openById.get(line.bill.id) ??
              ({
                id: line.bill.id,
                billNumber: line.bill.billNumber ?? "",
                vendorInvoiceNumber: line.bill.vendorInvoiceNumber,
                billDate: "",
                dueDate: line.bill.dueDate,
                totalMinor: line.bill.totalMinor,
                outstandingMinor: line.bill.outstandingMinor,
                netMinor: line.bill.totalMinor,
              } satisfies OpenBillOption),
            amountMinor: line.amountMinor,
            withholdingTaxRateId: line.withholdingTaxRate?.id ?? null,
          })),
        }}
      />
    </div>
  );
}
