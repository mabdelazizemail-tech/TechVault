import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/primitives";
import { ERP_PERMISSIONS } from "@/modules/erp/contracts/permissions";
import { BillForm } from "@/modules/erp/ui/bill-form";
import { billFormOptions } from "@/modules/erp/ui/bill-form-options";
import { todayInCairo } from "@/modules/erp/ui/format";
import { getActor } from "@/platform/auth/current-user";
import { canGlobally } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "New bill" };

export default async function NewBillPage() {
  const actor = await getActor();
  if (!(await canGlobally(actor, ERP_PERMISSIONS.AP_BILL_CREATE))) notFound();
  const options = await billFormOptions(actor);

  return (
    <div>
      <PageHeader
        title="New bill"
        description="Record a supplier's invoice as a draft. The server prices every line; submit it for approval from its page."
      />
      <BillForm mode="create" {...options} defaultDate={todayInCairo()} />
    </div>
  );
}
