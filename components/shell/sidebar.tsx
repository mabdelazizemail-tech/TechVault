"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  BookText,
  Bot,
  Building2,
  CalendarRange,
  Circle,
  Landmark,
  ListTree,
  Split,
  CalendarClock,
  FileText,
  Handshake,
  ReceiptText,
  Settings2,
  Banknote,
  FileInput,
  Hourglass,
  SlidersHorizontal,
  Truck,
  Compass,
  Contact,
  FolderKanban,
  KeyRound,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  Network,
  ScrollText,
  Shield,
  SquareCheckBig,
  SquareKanban,
  StickyNote,
  Tags,
  Target,
  UserCog,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { DASHBOARD_ITEM, type NavItem, type NavSection } from "./navigation";

/**
 * The platform navigation (CLAUDE.md §16.2): every section the user may reach,
 * grouped under a small uppercase label, each screen one row with an icon. The
 * current screen is filled with ink.
 *
 * Receives already-filtered sections: the permission decisions are made on the
 * server, so the client never learns which modules exist that this user may not
 * reach. A client component only because it highlights the active route; the same
 * list renders in the desktop sidebar and the mobile drawer.
 */

const ITEM_ICONS: Record<string, LucideIcon> = {
  "/dashboard": LayoutDashboard,
  "/crm": Target,
  "/crm/leads": UsersRound,
  "/crm/opportunities": SquareKanban,
  "/crm/accounts": Building2,
  "/crm/contacts": Contact,
  "/crm/activities": ListChecks,
  "/crm/tasks": SquareCheckBig,
  "/crm/notes": StickyNote,
  "/erp/finance": Landmark,
  "/erp/finance/accounts": ListTree,
  "/erp/finance/journals": BookText,
  "/erp/finance/periods": CalendarRange,
  "/erp/finance/cost-centres": Split,
  "/erp/finance/invoices": FileText,
  "/erp/finance/receipts": ReceiptText,
  "/erp/finance/customers": Handshake,
  "/erp/finance/aging": CalendarClock,
  "/erp/finance/ar-settings": Settings2,
  "/erp/finance/bills": FileInput,
  "/erp/finance/payments": Banknote,
  "/erp/finance/vendors": Truck,
  "/erp/finance/ap-aging": Hourglass,
  "/erp/finance/ap-settings": SlidersHorizontal,
  "/innovation": Compass,
  "/innovation/ideas": Lightbulb,
  "/innovation/knowledge": BookOpen,
  "/innovation/projects": FolderKanban,
  "/innovation/ask": Bot,
  "/innovation/categories": Tags,
  "/admin/users": UserCog,
  "/admin/roles": Shield,
  "/admin/permissions": KeyRound,
  "/admin/org-units": Network,
  "/admin/audit": ScrollText,
};

export function Sidebar({
  sections,
  onNavigate,
}: {
  sections: readonly NavSection[];
  /** Called when a link is chosen — the mobile drawer closes itself with it. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const isCurrent = (item: NavItem) =>
    item.exact === true
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(`${item.href}/`);

  const groups = [
    { key: "overview", label: "Overview", items: [DASHBOARD_ITEM] },
    ...sections,
  ];

  return (
    <nav aria-label="Main navigation" className="flex flex-col gap-6 p-4">
      {groups.map((group) => (
        <div key={group.key}>
          <p className="label-caps mb-2 px-2">{group.label}</p>
          <ul className="flex flex-col">
            {group.items.map((item) => {
              const active = isCurrent(item);
              const Icon = ITEM_ICONS[item.href] ?? Circle;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 px-2 py-2 text-sm font-medium transition-colors duration-150 pointer-coarse:py-3",
                      active
                        ? "bg-primary text-primary-foreground"
                        : "text-foreground hover:bg-surface-hover",
                    )}
                  >
                    <Icon aria-hidden="true" className="size-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
