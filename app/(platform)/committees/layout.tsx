import { notFound } from "next/navigation";
import { COMMITTEES_PERMISSIONS } from "@/modules/committees/contracts/permissions";
import { getActor } from "@/platform/auth/current-user";
import { can } from "@/platform/authz/authz";

/** Committees exist only for people who may open them (§11.6). */
export default async function CommitteesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const actor = await getActor();
  if (!(await can(actor, COMMITTEES_PERMISSIONS.ACCESS))) notFound();
  return children;
}
