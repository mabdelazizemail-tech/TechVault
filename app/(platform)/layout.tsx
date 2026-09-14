import { Brand } from "@/components/shell/brand";
import { Header } from "@/components/shell/header";
import { MobileNav } from "@/components/shell/mobile-nav";
import { Sidebar } from "@/components/shell/sidebar";
import { UserMenu } from "@/components/shell/user-menu";
import { NAV_SECTIONS, navigationPermissionKeys } from "@/components/shell/navigation";
import { ToastProvider } from "@/components/ui/toast";
import { signOut } from "@/app/auth/actions";
import { MESSAGING_PERMISSIONS } from "@/modules/messaging/contracts/permissions";
import { MessagingProvider } from "@/modules/messaging/ui/messaging-provider";
import { Messenger } from "@/modules/messaging/ui/messenger/messenger";
import { requireUser } from "@/platform/auth/current-user";
import { canAll } from "@/platform/authz/authz";

/**
 * The authenticated platform shell (CLAUDE.md §16.2).
 *
 * Every module renders inside this: the sidebar with the brand at the inline start,
 * and beside it the header (breadcrumbs, theme, user menu) over a scrolling content
 * column. Below `lg` the sidebar becomes a drawer opened from the header.
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
  const permitted = await canAll({ id: user.id }, [
    ...navigationPermissionKeys(),
    MESSAGING_PERMISSIONS.ACCESS,
  ]);
  const hasMessaging = permitted[MESSAGING_PERMISSIONS.ACCESS] === true;

  const sections = NAV_SECTIONS.filter(
    (section) => permitted[section.permission] === true,
  )
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => permitted[item.permission] === true),
    }))
    // A section whose every entry is hidden is noise, not navigation.
    .filter((section) => section.items.length > 0);

  const shell = (
    <div className="bg-canvas flex h-dvh overflow-hidden">
      <aside className="bg-surface rule-e hidden w-(--spacing-sidebar) shrink-0 flex-col lg:flex">
        <div className="rule-b flex h-(--spacing-header) shrink-0 items-center px-4">
          <Brand />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Sidebar sections={sections} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          mobileNav={<MobileNav sections={sections} />}
          userMenu={
            <UserMenu fullName={user.fullName} email={user.email} onSignOut={signOut} />
          }
        />
        <main className="min-h-0 flex-1 overflow-y-auto">
          {/* Bottom padding keeps the last row clear of the Messenger launcher. */}
          <div className="animate-tv-fade px-4 pt-6 pb-24 sm:px-6">{children}</div>
        </main>
      </div>
    </div>
  );

  // The Messenger lives here, in the layout Next.js keeps mounted across
  // navigation, so open chats survive moving between pages. It exists only for
  // people who may use it, and connects to Realtime once the page is idle.
  return (
    <ToastProvider>
      {hasMessaging ? (
        <MessagingProvider me={{ id: user.id, name: user.fullName ?? user.email }}>
          {shell}
          <Messenger />
        </MessagingProvider>
      ) : (
        shell
      )}
    </ToastProvider>
  );
}
