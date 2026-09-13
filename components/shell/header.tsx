import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeToggle } from "./theme-toggle";

/**
 * The platform header (CLAUDE.md §16.2): brand, theme switch, user menu. Identical
 * across every module.
 *
 * The design also places global search, "Create", the AI assistant, tasks and
 * notifications here. Those features do not exist yet, so they are slots rather
 * than inert buttons — a control that does nothing is decorative UI (§17.6).
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
    <header className="border-border-strong bg-surface flex h-(--spacing-header) shrink-0 items-center gap-3.5 border-b-2 px-4">
      <Link
        href="/dashboard"
        className="text-foreground flex shrink-0 items-center gap-2.5"
      >
        <span
          aria-hidden="true"
          className="bg-primary text-primary-foreground grid size-[26px] place-items-center text-xs font-extrabold"
        >
          TV
        </span>
        <span className="text-base font-extrabold tracking-[-0.01em]">TechVault</span>
      </Link>

      {search !== undefined && (
        <>
          <Divider />
          {search}
        </>
      )}

      <div className="flex-1" />

      {notifications}
      <ThemeToggle />
      <Divider />
      {userMenu}
    </header>
  );
}

function Divider() {
  return <span aria-hidden="true" className="bg-border h-6 w-px shrink-0" />;
}
