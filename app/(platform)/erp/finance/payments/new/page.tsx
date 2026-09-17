import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/primitives";
import { ERP_PERMISSIONS } from "@/modules/erp/contracts/permissions";
import { getVendor, listOpenBills } from "@/modules/erp/contracts/service";
import { flatParams } from "@/modules/erp/ui/page-helpers";
import { PaymentForm } from "@/modules/erp/ui/payment-form";
import { paymentFormOptions } from "@/modules/erp/ui/payment-form-options";
import { todayInCairo } from "@/modules/erp/ui/format";
import { getActor } from "@/platform/auth/current-user";
import { canAllGlobally } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "New payment" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `?vendor=<id>` opens the form with that vendor's open bills and usual withholding rate. */
export default async function NewPaymentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = flatParams(await searchParams);
  const actor = await getActor();
  const rights = await canAllGlobally(actor, [
    ERP_PERMISSIONS.AP_PAYMENT_CREATE,
    ERP_PERMISSIONS.AP_VENDOR_READ,
  ]);
  if (rights[ERP_PERMISSIONS.AP_PAYMENT_CREATE] !== true) notFound();

  const vendorId =
    query.vendor !== undefined &&
    UUID.test(query.vendor) &&
    rights[ERP_PERMISSIONS.AP_VENDOR_READ] === true
      ? query.vendor
      : null;
  const [options, vendor, openBills] = await Promise.all([
    paymentFormOptions(actor),
    vendorId === null ? Promise.resolve(null) : getVendor(actor, vendorId).catch(() => null),
    vendorId === null ? Promise.resolve([]) : listOpenBills(actor, vendorId),
  ]);
  const preselected = vendor !== null && vendor.isActive ? vendor : null;

  return (
    <div>
      <PageHeader
        title="New payment"
        description="Saved as a draft. Choose the bills it settles; submit it for approval from its page."
      />
      <PaymentForm
        mode="create"
        {...options}
        {...(preselected !== null
          ? {
              initialVendor: {
                id: preselected.id,
                name: preselected.name,
                isActive: preselected.isActive,
              },
              initialOpenBills: openBills,
              defaultWithholdingRateId: preselected.defaultWithholdingTaxRate?.id ?? null,
            }
          : {})}
        defaultDate={todayInCairo()}
      />
    </div>
  );
}
