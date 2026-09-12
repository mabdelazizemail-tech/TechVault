"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { DASHBOARD_ITEM, type NavSection } from "./navigation";

/**
 * The platform sidebar (CLAUDE.md §16.2).
 *
 * Receives already-filtered sections: the permission decisions are made on the
 * server, so the client never learns which modules exist that this user may not
 * reach. A client component only because it highlights the active route.
 */
export function Sidebar({ sections }: { sections: readonly NavSection[] }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main navigation"
      className="border-border bg-surface flex h-full w-(--spacing-sidebar) shrink-0 flex-col gap-4 overflow-y-auto border-e px-2 py-3"
    >
      <ul className="flex flex-col gap-0.5">
        <NavLink
          href={DASHBOARD_ITEM.href}
          label={DASHBOARD_ITEM.label}
          isActive={pathname === DASHBOARD_ITEM.href}
        />
      </ul>

      {sections.map((section) => (
        <div key={section.key} className="flex flex-col gap-1">
          <h2 className="text-foreground-subtle px-2 text-[0.6875rem] font-semibold tracking-wide uppercase">
            {section.label}
          </h2>
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => (
              <NavLink
                key={item.href}
                href={item.href}
                label={item.label}
                isActive={pathname === item.href || pathname.startsWith(`${item.href}/`)}
              />
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function NavLink({
  href,
  label,
  isActive,
}: {
  href: string;
  label: string;
  isActive: boolean;
}) {
  return (
    <li>
      <Link
        href={href}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "block rounded-(--radius-control) px-2 py-1.5 text-sm",
          isActive
            ? "bg-surface-selected text-foreground font-medium"
            : "text-foreground-muted hover:bg-surface-hover hover:text-foreground",
        )}
      >
        {label}
      </Link>
    </li>
  );
}
