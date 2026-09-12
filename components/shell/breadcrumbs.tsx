"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { labelForSegment } from "./navigation";

/**
 * Breadcrumbs derived from the route (CLAUDE.md §16.2).
 *
 * Derived rather than declared per page, so they can never drift out of sync with
 * where the user actually is. Segments that look like IDs are shown as a short
 * reference instead of a raw UUID.
 */
export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter((segment) => segment !== "");

  if (segments.length <= 1) return null;

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="text-foreground-muted flex items-center gap-1.5 text-xs">
        {segments.map((segment, index) => {
          const href = `/${segments.slice(0, index + 1).join("/")}`;
          const isLast = index === segments.length - 1;
          const label = isIdLike(segment)
            ? `#${segment.slice(0, 8)}`
            : labelForSegment(segment);

          return (
            <li key={href} className="flex min-w-0 items-center gap-1.5">
              {index > 0 && (
                <span aria-hidden="true" className="text-foreground-subtle">
                  /
                </span>
              )}
              {isLast ? (
                <span aria-current="page" className="text-foreground truncate">
                  {label}
                </span>
              ) : (
                <Link href={href} className="hover:text-foreground truncate">
                  {label}
                </Link>
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
