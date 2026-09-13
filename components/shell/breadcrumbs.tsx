"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { labelForSegment } from "./navigation";

/**
 * Breadcrumbs derived from the route (CLAUDE.md §16.2), rooted at TechVault as in
 * the design. Derived rather than declared per page, so they can never drift out
 * of sync with where the user actually is. Segments that look like IDs are shown
 * as a short reference instead of a raw UUID.
 */
export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter((segment) => segment !== "");

  const trail = [{ href: "/dashboard", label: "TechVault" }];
  segments.forEach((segment, index) => {
    // The dashboard IS the root; listing it again would read "TechVault / Dashboard".
    if (segment === "dashboard") return;
    trail.push({
      href: `/${segments.slice(0, index + 1).join("/")}`,
      label: isIdLike(segment) ? `#${segment.slice(0, 8)}` : labelForSegment(segment),
    });
  });

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="text-foreground-muted flex flex-wrap items-center gap-[7px] text-[11.5px]">
        {trail.map((crumb, index) => {
          const isLast = index === trail.length - 1;
          return (
            <li key={crumb.href} className="flex min-w-0 items-center gap-[7px]">
              {isLast ? (
                <span
                  aria-current="page"
                  className="text-foreground truncate font-extrabold"
                >
                  {crumb.label}
                </span>
              ) : (
                <>
                  <Link href={crumb.href} className="hover:text-foreground truncate">
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
