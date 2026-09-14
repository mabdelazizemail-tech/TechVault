import { notFound } from "next/navigation";
import { ERP_PERMISSIONS } from "@/modules/erp/contracts/permissions";
import { getActor } from "@/platform/auth/current-user";
import { can } from "@/platform/authz/authz";

/** ERP exists only for people who may open it (§11.6). */
export default async function ErpLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();
  if (!(await can(actor, ERP_PERMISSIONS.ACCESS))) notFound();
  return children;
}
