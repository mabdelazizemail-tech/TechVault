"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useSyncExternalStore } from "react";
import { labelForPath } from "./navigation";

/**
 * Breadcrumbs derived from the route (CLAUDE.md §16.2), rooted at TechVault as in
 * the design. Derived rather than declared per page, so they can never drift out
 * of sync with where the user actually is.
 *
 * A record's ID segment shows the record's name, which the detail page supplies
 * with `<BreadcrumbTitle>` — the breadcrumb lives in the shared layout and never
 * sees the record itself. Until a name is registered (the first paint of a full
 * page load), the segment reads as the record type, "Lead" or "Company", never a
 * raw ID.
 */

const titles = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify() {
  version += 1;
  for (const listener of listeners) listener();
}

/**
 * Names the record behind an ID segment of the current URL. Render it on a detail
 * page: `<BreadcrumbTitle segment={id} label={lead.name} />`.
 */
export function BreadcrumbTitle({ segment, label }: { segment: string; label: string }) {
  // A layout effect, so on client navigation the name replaces the fallback
  // before the browser paints.
  useLayoutEffect(() => {
    titles.set(segment, label);
    notify();
    return () => {
      if (titles.get(segment) === label) {
        titles.delete(segment);
        notify();
      }
    };
  }, [segment, label]);

  return null;
}

/** What an unnamed ID segment reads as, by the collection it sits under. */
const RECORD_LABELS: Record<string, string> = {
  leads: "Lead",
  accounts: "Company",
  contacts: "Contact",
  opportunities: "Opportunity",
  users: "User",
  ideas: "Idea",
  knowledge: "Knowledge",
  projects: "Project",
};

const ERP_RECORD_LABELS: Record<string, string> = {
  accounts: "Account",
  journals: "Journal entry",
  invoices: "Invoice",
  receipts: "Receipt",
  customers: "Customer",
};

export function Breadcrumbs() {
  const pathname = usePathname();
  // Re-render when a page registers or clears a record name.
  useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );
  const segments = pathname.split("/").filter((segment) => segment !== "");

  // Where you are, from the module down; on the dashboard itself, just "Dashboard".
  const trail: { href: string; label: string }[] = [];
  segments.forEach((segment, index) => {
    if (segment === "dashboard" && index === 0) {
      trail.push({ href: "/dashboard", label: "Dashboard" });
      return;
    }
    const parent = segments[index - 1] ?? "";
    const href = `/${segments.slice(0, index + 1).join("/")}`;
    // ERP finance has its own "accounts" — ledger accounts, not CRM companies.
    const recordLabel =
      segments[0] === "erp" ? ERP_RECORD_LABELS[parent] : RECORD_LABELS[parent];
    trail.push({
      href,
      label: isIdLike(segment)
        ? (titles.get(segment) ?? recordLabel ?? "Details")
        : labelForPath(href, segment),
    });
  });

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="text-foreground-muted flex min-w-0 items-center gap-2 text-sm">
        {trail.map((crumb, index) => {
          const isLast = index === trail.length - 1;
          return (
            <li
              key={crumb.href}
              className={
                isLast
                  ? "flex min-w-0 items-center gap-2"
                  : "hidden min-w-0 items-center gap-2 sm:flex"
              }
            >
              {isLast ? (
                <span
                  aria-current="page"
                  title={crumb.label}
                  dir="auto"
                  className="text-foreground truncate font-semibold"
                >
                  {crumb.label}
                </span>
              ) : (
                <>
                  <Link
                    href={crumb.href}
                    title={crumb.label}
                    dir="auto"
                    className="hover:text-foreground truncate"
                  >
                    {crumb.label}
                  </Link>
                  <span aria-hidden="true" className="text-foreground-subtle">
                    /
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isIdLike(segment: string): boolean {
  return UUID_PATTERN.test(segment) || /^\d+$/.test(segment);
}
