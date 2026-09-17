import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/primitives";
import { ERP_PERMISSIONS } from "@/modules/erp/contracts/permissions";
import { vendorFormOptions } from "@/modules/erp/ui/vendor-form-options";
import { VendorForm } from "@/modules/erp/ui/vendor-form";
import { getActor } from "@/platform/auth/current-user";
import { canGlobally } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "New vendor" };

export default async function NewVendorPage() {
  const actor = await getActor();
  if (!(await canGlobally(actor, ERP_PERMISSIONS.AP_VENDOR_CREATE))) notFound();
  const options = await vendorFormOptions(actor);

  return (
    <div>
      <PageHeader
        title="New vendor"
        description="A supplier whose bills you record and pay. It can be linked to a CRM company."
      />
      <VendorForm {...options} />
    </div>
  );
}
