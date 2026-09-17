import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BreadcrumbTitle } from "@/components/shell/breadcrumbs";
import { PageHeader } from "@/components/ui/primitives";
import { ERP_PERMISSIONS } from "@/modules/erp/contracts/permissions";
import { getVendor } from "@/modules/erp/contracts/service";
import { orNotFound } from "@/modules/erp/ui/page-helpers";
import { vendorFormOptions } from "@/modules/erp/ui/vendor-form-options";
import { VendorForm } from "@/modules/erp/ui/vendor-form";
import { getActor } from "@/platform/auth/current-user";
import { canGlobally } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Edit vendor" };

export default async function EditVendorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await getActor();
  if (!(await canGlobally(actor, ERP_PERMISSIONS.AP_VENDOR_UPDATE))) notFound();
  const [vendor, options] = await Promise.all([
    orNotFound(getVendor(actor, id)),
    vendorFormOptions(actor),
  ]);

  return (
    <div>
      <BreadcrumbTitle segment={id} label={vendor.name} />
      <PageHeader title={`Edit ${vendor.name}`} />
      <VendorForm
        {...options}
        vendorId={vendor.id}
        initial={{
          name: vendor.name,
          nameAr: vendor.nameAr,
          taxRegistrationNumber: vendor.taxRegistrationNumber,
          crmAccount: vendor.crmAccount,
          email: vendor.email,
          phone: vendor.phone,
          address: vendor.address,
          paymentTermsDays: vendor.paymentTermsDays,
          payableAccountId: vendor.payableAccount?.id ?? null,
          defaultExpenseAccountId: vendor.defaultExpenseAccount?.id ?? null,
          defaultWithholdingTaxRateId: vendor.defaultWithholdingTaxRate?.id ?? null,
          notes: vendor.notes,
          isActive: vendor.isActive,
        }}
      />
    </div>
  );
}
