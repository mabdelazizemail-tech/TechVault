"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  FileText,
  Landmark,
  LayoutGrid,
  Lightbulb,
  ShieldCheck,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { DASHBOARD_ITEM, type NavSection } from "./navigation";

/**
 * The platform sidebar (CLAUDE.md §16.2).
 *
 * Receives already-filtered sections: the permission decisions are made on the
 * server, so the client never learns which modules exist that this user may not
 * reach. A client component only because it highlights the active route.
 *
 * Layout follows the design: one row per module with an icon; the active module
 * shows a 3px accent edge and expands to list its screens beneath it.
 */

const SECTION_ICONS: Record<string, LucideIcon> = {
  crm: Users,
  erp: Landmark,
  ecm: FileText,
  hris: UserRound,
  innovation: Lightbulb,
  bi: BarChart3,
  admin: ShieldCheck,
};

export function Sidebar({ sections }: { sections: readonly NavSection[] }) {
  const pathname = usePathname();
  const isWithin = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav
      aria-label="Main navigation"
      className="border-border-strong bg-surface flex h-full w-(--spacing-sidebar) shrink-0 flex-col overflow-hidden border-e-2"
    >
      <div className="flex-1 overflow-x-hidden overflow-y-auto py-2.5">
        <ul>
          <li>
            <ModuleLink
              href={DASHBOARD_ITEM.href}
              label={DASHBOARD_ITEM.label}
              Icon={LayoutGrid}
              isActive={isWithin(DASHBOARD_ITEM.href)}
              isPage={isWithin(DASHBOARD_ITEM.href)}
            />
          </li>

          {sections.map((section) => {
            const isActive = section.items.some((item) => isWithin(item.href));
            const first = section.items[0];
            if (first === undefined) return null;

            return (
              <li key={section.key}>
                <ModuleLink
                  href={first.href}
                  label={section.label}
                  Icon={SECTION_ICONS[section.key] ?? LayoutGrid}
                  isActive={isActive}
                  isPage={false}
                />
                {isActive && (
                  <ul className="pt-0.5 pb-2">
                    {section.items.map((item) => {
                      const isCurrent = isWithin(item.href);
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            aria-current={isCurrent ? "page" : undefined}
                            className={cn(
                              "block border-s-3 py-1.5 ps-11 pe-3.5 text-[12.5px]",
                              isCurrent
                                ? "border-primary text-foreground font-extrabold"
                                : "text-foreground-muted hover:text-foreground border-transparent",
                            )}
                          >
                            {item.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="border-border text-foreground-subtle shrink-0 truncate border-t px-4 py-2.5 text-[10.5px] tracking-[0.04em]">
        TechVault · Phase 1
      </div>
    </nav>
  );
}

function ModuleLink({
  href,
  label,
  Icon,
  isActive,
  isPage,
}: {
  href: string;
  label: string;
  Icon: LucideIcon;
  isActive: boolean;
  /** True only when this row is itself the current page (not a parent of it). */
  isPage: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={isPage ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-2.5 border-s-3 py-2 ps-3 pe-3.5 text-[13.5px] whitespace-nowrap",
        isActive
          ? "border-primary bg-surface-sunken text-foreground font-extrabold"
          : "text-foreground-muted hover:bg-surface-hover hover:text-foreground border-transparent",
      )}
    >
      <Icon aria-hidden="true" size={17} strokeWidth={2} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </Link>
  );
}
