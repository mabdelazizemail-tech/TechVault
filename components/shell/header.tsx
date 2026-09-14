import type { ReactNode } from "react";
import { Breadcrumbs } from "./breadcrumbs";
import { ThemeToggle } from "./theme-toggle";

/**
 * The platform header (CLAUDE.md §16.2): the menu button on small screens, where
 * you are, the theme switch and the user menu. Identical across every module.
 *
 * Global search and notifications are slots rather than inert buttons: those
 * features do not exist yet, and a control that does nothing is decorative UI
 * (§17.6).
 */
export function Header({
  mobileNav,
  userMenu,
  search,
  notifications,
}: {
  mobileNav: ReactNode;
  userMenu: ReactNode;
  search?: ReactNode;
  notifications?: ReactNode;
}) {
  return (
    <header className="bg-surface rule-b z-30 flex h-(--spacing-header) shrink-0 items-center gap-3 px-4">
      {mobileNav}
      <div className="min-w-0 flex-1">
        <Breadcrumbs />
      </div>
      {search}
      {notifications}
      <ThemeToggle />
      {userMenu}
    </header>
  );
}
