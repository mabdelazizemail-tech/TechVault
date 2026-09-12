import type { ReactNode } from "react";
import { Breadcrumbs } from "./breadcrumbs";

/**
 * The platform header (CLAUDE.md §16.2): breadcrumbs, global search slot,
 * notifications slot, user menu. Identical across every module — a user should
 * never feel they changed systems.
 *
 * Search and notifications are slots rather than implementations: they arrive in
 * Phase 3 (search) and Phase 2 (notifications). Rendering a non-functional search
 * box would be decorative UI, which §17.6 forbids.
 */
export function Header({
  userMenu,
  search,
  notifications,
}: {
  userMenu: ReactNode;
  search?: ReactNode;
  notifications?: ReactNode;
}) {
  return (
    <header className="border-border bg-surface flex h-(--spacing-header) shrink-0 items-center gap-4 border-b px-4">
      <Breadcrumbs />
      <div className="flex-1" />
      {search}
      {notifications}
      {userMenu}
    </header>
  );
}
