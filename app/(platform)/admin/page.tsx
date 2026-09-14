import { notFound, redirect } from "next/navigation";
import { NAV_SECTIONS } from "@/components/shell/navigation";
import { requireUser } from "@/platform/auth/current-user";
import { canAll } from "@/platform/authz/authz";

/**
 * `/admin` has no screen of its own; the breadcrumb and the sidebar section both
 * point here. Send the visitor to the first administration page they may open,
 * in sidebar order. Without any, it is a 404 like every other page they may not
 * reach (CLAUDE.md §11.6) — each target page authorises again regardless.
 */
export default async function AdminIndexPage() {
  const user = await requireUser();
  const section = NAV_SECTIONS.find((candidate) => candidate.key === "admin");
  if (section === undefined) notFound();

  const permitted = await canAll({ id: user.id }, [
    section.permission,
    ...section.items.map((item) => item.permission),
  ]);
  if (permitted[section.permission] !== true) notFound();

  const first = section.items.find((item) => permitted[item.permission] === true);
  if (first === undefined) notFound();
  redirect(first.href);
}
