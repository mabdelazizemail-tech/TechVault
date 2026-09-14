import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { CRM_PERMISSIONS } from "@/modules/crm/contracts/permissions";
import { CrmSearchBox } from "@/modules/crm/ui/crm-search-box";
import { getActor } from "@/platform/auth/current-user";
import { can } from "@/platform/authz/authz";

/**
 * The CRM section. Without module access the whole section is a 404 — the
 * navigation already hides it, and every service re-checks regardless (§11.4).
 */
export default async function CrmLayout({ children }: { children: ReactNode }) {
  const actor = await getActor();
  if (!(await can(actor, CRM_PERMISSIONS.ACCESS))) notFound();

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Suspense fallback={<div className="h-9 w-full sm:w-80" />}>
          <CrmSearchBox />
        </Suspense>
      </div>
      {children}
    </div>
  );
}
