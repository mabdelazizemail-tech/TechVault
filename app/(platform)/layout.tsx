import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { Header } from "@/components/shell/header";
import { Sidebar } from "@/components/shell/sidebar";
import { UserMenu } from "@/components/shell/user-menu";
import { NAV_SECTIONS, navigationPermissionKeys } from "@/components/shell/navigation";
import { signOut } from "@/app/auth/actions";
import { requireUser } from "@/platform/auth/current-user";
import { canAll } from "@/platform/authz/authz";

/**
 * The authenticated platform shell (CLAUDE.md §16.2).
 *
 * Every module renders inside this: a full-width header, the sidebar beneath it,
 * and a content column that opens with the breadcrumb trail — the layout of the
 * TechVault design.
 *
 * Navigation is filtered on the SERVER: the browser never receives the list of
 * modules this user may not reach. Hiding a link is a usability decision, not a
 * security control — every operation behind it is independently authorised
 * (§11.4).
 */
export default async function PlatformLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requireUser();

  // One batched evaluation against the request-cached permission set, rather than
  // a round trip per menu entry.
  const permitted = await canAll({ id: user.id }, navigationPermissionKeys());

  const sections = NAV_SECTIONS.filter(
    (section) => permitted[section.permission] === true,
  )
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => permitted[item.permission] === true),
    }))
    // A section whose every entry is hidden is noise, not navigation.
    .filter((section) => section.items.length > 0);

  return (
    <div className="bg-canvas flex h-dvh flex-col overflow-hidden">
      <Header
        userMenu={
          <UserMenu fullName={user.fullName} email={user.email} onSignOut={signOut} />
        }
      />

      <div className="flex min-h-0 flex-1">
        <Sidebar sections={sections} />

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 px-6 pt-3.5 pb-2">
            <Breadcrumbs />
          </div>
          <div className="animate-tv-fade min-h-0 flex-1 overflow-y-auto px-6 pb-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
