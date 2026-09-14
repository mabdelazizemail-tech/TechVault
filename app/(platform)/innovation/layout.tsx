import { notFound } from "next/navigation";
import { INNOVATION_PERMISSIONS } from "@/modules/innovation/contracts/permissions";
import { getActor } from "@/platform/auth/current-user";
import { can } from "@/platform/authz/authz";

/** THE THINK TANK exists only for people who may open it (§11.6). */
export default async function InnovationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const actor = await getActor();
  if (!(await can(actor, INNOVATION_PERMISSIONS.ACCESS))) notFound();
  return children;
}
